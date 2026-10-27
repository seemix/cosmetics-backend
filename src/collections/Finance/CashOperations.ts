import { APIError, type Access, type CollectionBeforeChangeHook, type CollectionConfig, type PayloadRequest } from 'payload'

import { adminOrManager } from '@/access/adminOrManager'
import { hiddenUnlessAdminOrManager, isAdmin, isManager } from '@/access/isAdmin'
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
import {
  changeOrderPayment,
  depositToCustomer,
  refundCustomerAdvance,
  withdrawFromCustomer,
} from '@/services/finance/customerBalance.service'
import { assertCanAcceptPayment } from '@/services/finance/orderPayments.service'
import { changePayrollPaid } from '@/services/salary/payrollPayments.service'

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
  payroll: ['expense'],
  order: ['customer_receipt', 'customer_refund'],
  customer: ['customer_receipt', 'customer_refund'],
}

/** Розрахунки з покупцем (розд. 6.2, 6.4): надходження й повернення. */
const PAYMENT_TYPES = new Set<CashOperationType>(['customer_receipt', 'customer_refund'])

/** В19: типи, які manager створює й проводить сам (без статей зарплати). */
const MANAGER_TYPES = new Set<CashOperationType>(['expense', 'customer_receipt'])

/** В19: manager бачить лише створені ним операції. */
const readOperations: Access = ({ req: { user } }) => {
  if (isAdmin(user)) return true
  if (isManager(user)) return { createdBy: { equals: user?.id } }
  return false
}

/** В19: manager змінює й видаляє лише свої чернетки; проведене сторнує admin. */
const changeOperations: Access = ({ req: { user } }) => {
  if (isAdmin(user)) return true
  if (isManager(user)) return { createdBy: { equals: user?.id }, status: { equals: 'draft' } }
  return false
}

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'cash-operations',
  id,
  number: String(data.number ?? originalDoc.number),
})

/**
 * Оплата покупця в транзакції проведення (розд. 6.4), `status` замовлення не змінюється (В6).
 * Клієнт: надходження йде на аванс і гасить борги (спершу вказане замовлення), повернення без
 * замовлення бере з авансу, з замовленням зменшує його оплату. Гостьове замовлення: оплата прямо
 * в замовлення. `direction = -1` для сторно. Не оплата покупця ⇒ нічого.
 */
const changePayment = async (args: DocumentTransitionArgs, direction: 1 | -1) => {
  const { req, data, originalDoc } = args
  const type = (data.type ?? originalDoc.type) as CashOperationType
  if (!PAYMENT_TYPES.has(type)) return

  const order = idOf((data.order ?? originalDoc.order) as Relation)
  const customer = idOf((data.customer ?? originalDoc.customer) as Relation)
  const amountBani = Number(data.amountBani ?? originalDoc.amountBani)
  const move = {
    doc: docRef(args),
    // Проведення датується операцією, сторно своїм моментом, як і рухи каси.
    date: direction === 1 ? new Date(String(data.operationDate ?? originalDoc.operationDate)) : args.date,
  }
  const incoming = (type === 'customer_receipt') === (direction === 1)
  const kind = direction === 1 ? (type === 'customer_receipt' ? 'receipt' : 'refund') : 'reversal'

  if (type === 'customer_receipt' && direction === 1 && order) await assertCanAcceptPayment(req, String(order))

  if (!customer) {
    // Гостьове замовлення: валідація вимагає `order`, якщо клієнта немає.
    await changeOrderPayment(req, { ...move, order: String(order), customer: null, kind, deltaBani: incoming ? amountBani : -amountBani })
    return
  }

  if (incoming) {
    await depositToCustomer(req, { ...move, customer: String(customer), amountBani, kind, first: order ? String(order) : null })
  } else if (type === 'customer_receipt') {
    await withdrawFromCustomer(req, { ...move, customer: String(customer), amountBani })
  } else if (order) {
    await changeOrderPayment(req, { ...move, order: String(order), customer: String(customer), kind, deltaBani: -amountBani })
  } else {
    await refundCustomerAdvance(req, { ...move, customer: String(customer), amountBani })
  }
}

/**
 * Виплата зарплати за розрахунком (M4): `payroll.paidBani` атомарно в транзакції проведення.
 * Перевірки (проведений payroll, той самий менеджер, без переплати) стоять у фільтрі `$inc`.
 * Без `payroll` (аванс без розрахунку) нічого не змінюється. `direction = -1` для сторно.
 */
const changeSalaryPayment = async ({ req, data, originalDoc }: DocumentTransitionArgs, direction: 1 | -1) => {
  const value = (field: string) => (data[field] !== undefined ? data[field] : originalDoc[field]) as Relation | null
  const payroll = idOf(value('payroll'))
  if (!payroll) return

  const manager = idOf(value('manager'))
  await changePayrollPaid(req, {
    payroll: String(payroll),
    manager: manager ? String(manager) : null,
    deltaBani: direction * Number(data.amountBani ?? originalDoc.amountBani),
  })
}

/**
 * Проведення: рухи `cash-moves` датою `operationDate` і умовний `$inc` балансу; переказ змінює
 * обидві каси або жодну; оплата покупця змінює аванс клієнта й `paidBani` замовлень (розд. 6.2, 6.4).
 * Оплата оновлюється першою: її помилка повідомляється раніше за нестачу в касі.
 */
const postOperation = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc } = args
  const value = (field: string) => (data[field] ?? originalDoc[field]) as Relation | null | undefined

  await changePayment(args, 1)
  await changeSalaryPayment(args, 1)
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
 * Оплата повертається назад: сторно надходження клієнта знімає суму з авансу, а решту з оплат
 * найновіших замовлень; сторно повернення клієнта знову зараховує суму на аванс. Гостьове
 * замовлення: сторно надходження вимагає `paidBani ≥ amount`, сторно повернення не дає переплати.
 */
const reverseOperation = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  await changePayment(args, -1)
  await changeSalaryPayment(args, -1)

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
  // Тип і статтю manager перевіряє `validateOperation`, що йде раніше.
  canPost: (req) => isManager(req.user),
  onPost: postOperation,
  onReverse: reverseOperation,
})

/**
 * Обов'язкові зв'язки за типом (розд. 2.4, 6.2): перевіряються в чернетці й ще раз при проведенні.
 * Автор (`createdBy`) ставиться на create і далі не змінюється. Для manager (В19) лише `MANAGER_TYPES`
 * і статті без `isSalary`; менеджер і розрахунок зарплати в його операції очищаються.
 */
const validateOperation: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  data.createdBy = operation === 'create' ? (req.user?.id ?? null) : (idOf(originalDoc?.createdBy) ?? null)

  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const value = (field: string) => (data[field] !== undefined ? data[field] : originalDoc?.[field]) as Relation | null
  const type = (value('type') ?? 'expense') as unknown as CashOperationType
  const byManager = isManager(req.user)

  if (byManager && !MANAGER_TYPES.has(type)) fail(req, 'custom:error:managerCashOperationType', 403)

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

  if (PAYMENT_TYPES.has(type)) {
    const order = idOf(value('order'))

    if (order) {
      // З замовленням клієнт береться з нього; у гостьового замовлення порожній.
      const { customer } = await req.payload.findByID({ collection: 'orders', id: String(order), depth: 0, req })
      data.customer = idOf(customer)
    } else {
      // Без замовлення гроші йдуть на баланс клієнта, тож клієнт обов'язковий.
      data.customer = idOf(value('customer'))
      if (!data.customer) fail(req, 'custom:error:paymentCustomerRequired')
    }
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
    if (byManager) {
      if (isSalary) fail(req, 'custom:error:managerSalaryExpense', 403)
      data.manager = null
    }
    if (isSalary && !idOf(value('manager'))) fail(req, 'custom:error:salaryManagerRequired')
    // Розрахунок зарплати стосується лише статей зарплати.
    if (!isSalary) data.payroll = null
  }

  return data
}

const onlyFor = (type: CashOperationType) => (data: Record<string, unknown>) => data?.type === type
const onlyForPayments = (data: Record<string, unknown>) => PAYMENT_TYPES.has(data?.type as CashOperationType)

/** Касові операції: витрата, переказ, оплата постачальнику, надходження й повернення покупця; див. docs/accounting/design.md, розд. 2.4, 6.2, 6.4. */
export const CashOperations: CollectionConfig = {
  slug: 'cash-operations',
  labels: collectionLabels('custom:collection:cashOperations:singular', 'custom:collection:cashOperations:plural'),
  access: {
    read: readOperations,
    create: adminOrManager,
    update: changeOperations,
    delete: changeOperations,
  },
  admin: {
    hidden: hiddenUnlessAdminOrManager,
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'type', 'account', 'amountBani', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-createdAt',
  indexes: [
    { fields: ['type', 'status', 'operationDate'] },
    { fields: ['order'] },
    { fields: ['manager', 'category'] },
    { fields: ['createdBy', 'createdAt'] },
  ],
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
      filterOptions: ({ options, req }) =>
        isManager(req.user)
          ? options.filter((option) => MANAGER_TYPES.has((typeof option === 'string' ? option : option.value) as CashOperationType))
          : options,
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
          name: 'customer',
          label: label('custom:field:customer'),
          type: 'relationship',
          relationTo: 'users',
          filterOptions: { roles: { in: ['customer'] } },
          admin: { condition: onlyForPayments, description: description('custom:desc:paymentCustomer') },
        },
        {
          name: 'order',
          label: label('custom:field:order'),
          type: 'relationship',
          relationTo: 'orders',
          // Обраний клієнт звужує список до його замовлень; гостьові без клієнта.
          filterOptions: ({ data }) => (data?.customer ? { customer: { equals: idOf(data.customer as Relation) } } : true),
          admin: { condition: onlyForPayments, description: description('custom:desc:paymentOrder') },
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
          // Статті зарплати manager не бачить і так (read), тут вони ховаються зі списку явно.
          filterOptions: ({ req }) =>
            isManager(req.user) ? { and: [activeExpenseCategoriesOnly, { isSalary: { not_equals: true } }] } : activeExpenseCategoriesOnly,
          admin: { condition: onlyFor('expense') },
        },
        {
          name: 'manager',
          label: label('custom:field:manager'),
          type: 'relationship',
          relationTo: 'users',
          filterOptions: { roles: { in: ['manager'] } },
          admin: {
            condition: (data, _siblingData, { user }) => onlyFor('expense')(data) && !isManager(user),
            description: description('custom:desc:salaryCategory'),
          },
        },
      ],
    },
    {
      name: 'payroll',
      label: label('custom:term:payroll'),
      type: 'relationship',
      relationTo: 'payrolls',
      // Лише проведені розрахунки менеджера операції; сервер перевіряє те саме при проведенні.
      filterOptions: ({ data }) => ({
        status: { equals: 'posted' },
        ...(data?.manager ? { manager: { equals: idOf(data.manager as Relation) } } : {}),
      }),
      admin: {
        // Стаття у формі відома лише за id, тож поле видно, коли обрано менеджера (зарплата);
        // для статті без isSalary сервер очищає його.
        condition: (data) => data?.type === 'expense' && Boolean(data?.manager),
        description: description('custom:desc:salaryPayroll'),
      },
    },
    {
      name: 'createdBy',
      label: label('custom:field:createdBy'),
      type: 'relationship',
      relationTo: 'users',
      // Ставить `validateOperation`; за ним manager бачить свої операції (В19).
      admin: { readOnly: true, position: 'sidebar' },
    },
  ],
}
