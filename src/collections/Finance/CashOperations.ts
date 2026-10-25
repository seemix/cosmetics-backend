import { APIError, type CollectionBeforeChangeHook, type CollectionConfig, type PayloadRequest } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { activeCashAccountsOnly } from '@/collections/Finance/CashAccounts'
import { activeExpenseCategoriesOnly } from '@/collections/Finance/ExpenseCategories'
import { activeSuppliersOnly } from '@/collections/Suppliers'
import { moneyField } from '@/fields/money'
import { collectionLabels, customT, description, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import {
  applyCashMoves,
  cashOperationLines,
  revertCashMoves,
  type CashOperationType,
} from '@/services/finance/cashLedger.service'
import { assertCanAcceptPayment, changeOrderPaid } from '@/services/finance/orderPayments.service'

type Relation = string | { id: string }

const idOf = (value: Relation | null | undefined) => (value && typeof value === 'object' ? value.id : (value ?? null))

const fail = (
  req: PayloadRequest,
  key: CustomTranslationsKeys,
  status = 400,
  variables?: Record<string, string>,
): never => {
  throw new APIError(customT(req.t)(key, variables), status, undefined, true)
}

/** Часовий пояс обліку: «майбутнє» для дати операції рахується за календарним днем магазину. */
const ACCOUNTING_TIME_ZONE = 'Europe/Chisinau'

const dayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: ACCOUNTING_TIME_ZONE })

/**
 * Дата операції не пізніше сьогоднішнього дня й пізніше `lockedUntil` (розд. 3.1).
 * Порівнюється календарний день: date-picker адмінки зберігає день без точного часу.
 */
const assertOperationDate = async (req: PayloadRequest, value: unknown) => {
  if (!value) return
  const date = new Date(String(value))

  if (dayKey(date) > dayKey(new Date())) fail(req, 'custom:error:operationDateFuture')

  const { lockedUntil } = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  if (lockedUntil && date.getTime() <= new Date(lockedUntil).getTime()) {
    fail(req, 'custom:error:periodLocked', 409, { date: String(lockedUntil) })
  }
}

/** Поля, що стосуються лише свого типу операції; для інших типів очищаються. */
const FIELDS_BY_TYPE: Record<string, CashOperationType[]> = {
  toAccount: ['transfer'],
  supplier: ['supplier_payment'],
  purchase: ['supplier_payment'],
  category: ['expense'],
  manager: ['expense'],
  order: ['customer_receipt', 'customer_refund'],
  customer: ['customer_receipt', 'customer_refund'],
}

/** Зміна `paidBani` замовлення при проведенні: надходження збільшує, повернення зменшує (розд. 6.2). */
const PAYMENT_SIGN: Partial<Record<CashOperationType, 1 | -1>> = { customer_receipt: 1, customer_refund: -1 }

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'cash-operations',
  id,
  number: String(data.number ?? originalDoc.number),
})

/**
 * Оплата замовлення в транзакції проведення: `paidBani` і `paymentState` атомарно, `status` не
 * змінюється (В6). `direction = -1` для сторно. Не тип оплати замовлення ⇒ нічого.
 */
const changePayment = async ({ req, data, originalDoc }: DocumentTransitionArgs, direction: 1 | -1) => {
  const type = (data.type ?? originalDoc.type) as CashOperationType
  const sign = PAYMENT_SIGN[type]
  if (!sign) return

  const order = String(idOf((data.order ?? originalDoc.order) as Relation))
  const deltaBani = sign * direction * Number(data.amountBani ?? originalDoc.amountBani)

  if (type === 'customer_receipt' && direction === 1) await assertCanAcceptPayment(req, order)
  await changeOrderPaid(req, { order, deltaBani })
}

/**
 * Проведення: рухи `cash-moves` датою `operationDate` і умовний `$inc` балансу; переказ змінює
 * обидві каси або жодну; оплата покупця змінює `paidBani` замовлення (розд. 6.2).
 * Замовлення оновлюється першим: переплата повідомляється раніше за нестачу в касі.
 */
const postOperation = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc } = args
  const value = (field: string) => (data[field] ?? originalDoc[field]) as Relation | null | undefined

  await changePayment(args, 1)
  await applyCashMoves(req, {
    doc: docRef(args),
    date: new Date(String(data.operationDate ?? originalDoc.operationDate)),
    lines: cashOperationLines({
      type: value('type') as unknown as CashOperationType,
      account: String(idOf(value('account'))),
      toAccount: idOf(value('toAccount')),
      amountBani: Number(data.amountBani ?? originalDoc.amountBani),
    }),
  })
}

/**
 * Сторно: дзеркальні рухи датою сторно; якщо з каси-отримувача вже витрачено, помилка нестачі.
 * Оплата замовлення повертається назад: сторно надходження вимагає `paidBani ≥ amount`, сторно
 * повернення заборонене для скасованого замовлення й не дає переплати.
 */
const reverseOperation = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  await changePayment(args, -1)

  const { docs: moves } = await req.payload.find({
    collection: 'cash-moves',
    where: { docCollection: { equals: 'cash-operations' }, docId: { equals: id } },
    pagination: false,
    depth: 0,
    req,
  })

  await revertCashMoves(req, { doc: docRef(args), date, moves })
}

const lifecycle = documentLifecycle({
  prefix: 'CSH',
  counterKey: 'cashNumber',
  dateField: { name: 'operationDate', label: label('custom:field:operationDate') },
  onPost: postOperation,
  onReverse: reverseOperation,
})

/** Обов'язкові зв'язки за типом (розд. 2.4, 6.2): перевіряються в чернетці й ще раз при проведенні. */
const validateOperation: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const value = (field: string) => (data[field] !== undefined ? data[field] : originalDoc?.[field]) as Relation | null
  const type = (value('type') ?? 'expense') as unknown as CashOperationType

  await assertOperationDate(req, value('operationDate'))

  for (const [field, types] of Object.entries(FIELDS_BY_TYPE)) {
    if (!types.includes(type)) data[field] = null
  }

  if (type === 'transfer') {
    const toAccount = idOf(value('toAccount'))
    if (!toAccount) fail(req, 'custom:error:transferToAccountRequired')
    if (String(toAccount) === String(idOf(value('account')))) fail(req, 'custom:error:transferSameAccount')
  }

  if (type === 'supplier_payment' && !idOf(value('supplier'))) fail(req, 'custom:error:supplierPaymentSupplierRequired')

  if (PAYMENT_SIGN[type]) {
    const order = idOf(value('order'))
    if (!order) fail(req, 'custom:error:paymentOrderRequired')

    // Покупець лише копіюється із замовлення; у гостьового замовлення порожній.
    const { customer } = await req.payload.findByID({ collection: 'orders', id: String(order), depth: 0, req })
    data.customer = idOf(customer)
  }

  if (type === 'expense') {
    const category = idOf(value('category'))
    if (!category) fail(req, 'custom:error:expenseCategoryRequired')

    const { isSalary } = await req.payload.findByID({
      collection: 'expense-categories',
      id: String(category),
      depth: 0,
      req,
    })
    if (isSalary && !idOf(value('manager'))) fail(req, 'custom:error:salaryManagerRequired')
  }

  return data
}

const onlyFor = (type: CashOperationType) => (data: Record<string, unknown>) => data?.type === type
const onlyForPayments = (data: Record<string, unknown>) => Boolean(PAYMENT_SIGN[data?.type as CashOperationType])

/** Касові операції: витрата, переказ, оплата постачальнику, надходження й повернення покупця; див. docs/accounting/design.md, розд. 2.4, 6.2. */
export const CashOperations: CollectionConfig = {
  slug: 'cash-operations',
  labels: collectionLabels('custom:collection:cashOperations:singular', 'custom:collection:cashOperations:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'type', 'account', 'amountBani', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['type', 'status', 'operationDate'] }, { fields: ['order'] }, { fields: ['manager', 'category'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    // Спершу типові правила, потім статуси: проведення бачить очищені поля.
    beforeChange: [validateOperation, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'type',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      defaultValue: 'expense',
      options: [
        { label: label('custom:option:opExpense'), value: 'expense' },
        { label: label('custom:option:opTransfer'), value: 'transfer' },
        { label: label('custom:option:opSupplierPayment'), value: 'supplier_payment' },
        { label: label('custom:option:opCustomerReceipt'), value: 'customer_receipt' },
        { label: label('custom:option:opCustomerRefund'), value: 'customer_refund' },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'account',
          label: label('custom:term:cashAccount'),
          type: 'relationship',
          relationTo: 'cash-accounts',
          required: true,
          filterOptions: activeCashAccountsOnly,
        },
        {
          name: 'toAccount',
          label: label('custom:field:toAccount'),
          type: 'relationship',
          relationTo: 'cash-accounts',
          filterOptions: activeCashAccountsOnly,
          admin: { condition: onlyFor('transfer') },
        },
      ],
    },
    moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
    {
      type: 'row',
      fields: [
        {
          name: 'order',
          label: label('custom:field:order'),
          type: 'relationship',
          relationTo: 'orders',
          admin: { condition: onlyForPayments },
        },
        {
          name: 'customer',
          label: label('custom:field:customer'),
          type: 'relationship',
          relationTo: 'users',
          admin: { readOnly: true, condition: onlyForPayments },
        },
      ],
    },
    {
      name: 'supplier',
      label: label('custom:term:supplier'),
      type: 'relationship',
      relationTo: 'suppliers',
      index: true,
      filterOptions: activeSuppliersOnly,
      admin: { condition: onlyFor('supplier_payment') },
    },
    {
      name: 'purchase',
      label: label('custom:field:purchase'),
      type: 'relationship',
      relationTo: 'purchases',
      filterOptions: ({ data }) => (data?.supplier ? { supplier: { equals: idOf(data.supplier) } } : true),
      admin: { condition: onlyFor('supplier_payment'), description: description('custom:desc:purchaseForReference') },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'category',
          label: label('custom:field:expenseCategory'),
          type: 'relationship',
          relationTo: 'expense-categories',
          filterOptions: activeExpenseCategoriesOnly,
          admin: { condition: onlyFor('expense') },
        },
        {
          name: 'manager',
          label: label('custom:field:manager'),
          type: 'relationship',
          relationTo: 'users',
          filterOptions: { roles: { in: ['manager'] } },
          admin: { condition: onlyFor('expense'), description: description('custom:desc:salaryCategory') },
        },
      ],
    },
  ],
}
