import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest,
} from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { activeCashAccountsOnly } from '@/collections/Finance/CashAccounts'
import { applyCashMoves, revertCashMoves } from '@/services/finance/cashLedger.service'
import { validateInteger } from '@/collections/Stock/shared'
import { activeSuppliersOnly } from '@/collections/Suppliers'
import { moneyField } from '@/fields/money'
import { collectionLabels, customT, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import {
  depositToCustomer,
  refreshCustomerDebt,
  releaseOrderPayment,
  settleCustomer,
  withdrawFromCustomer,
} from '@/services/finance/customerBalance.service'
import { getOrderRevenueBani, type PaymentOrder } from '@/services/finance/orderPayments.service'
import { requireSession } from '@/services/stock/session'
import { receive, revert } from '@/services/stock/stockLedger.service'
import { formatMDL } from '@/utilities/money'

type Relation = string | { id: string }
type StockLine = { product: Relation; quantity: number; unitCostBani: number }
type CashLine = { account: Relation; amountBani: number }
type SupplierLine = { supplier: Relation; amountBani: number }
type CustomerLine = { order: Relation; amountBani: number }
type AdvanceLine = { customer: Relation; amountBani: number }
type Kind = 'stock' | 'cash' | 'supplierDebt' | 'customerDebt' | 'customerAdvance'
type OrderDoc = PaymentOrder & { _id: { toString(): string }; customer?: { toString(): string } | null }

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const fail = (req: PayloadRequest, key: CustomTranslationsKeys): never => {
  throw new APIError(customT(req.t)(key), 400, undefined, true)
}

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'opening-balances',
  id,
  number: String(data.number ?? originalDoc.number),
})

/** Проведення kind=stock як прихід на склад шапки: вартість рядка `quantity × unitCostBani`, рух `opening` (розд. 3.2). */
const postOpening = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.stockLines ?? originalDoc.stockLines ?? []) as StockLine[]
  const warehouse = idOf((data.warehouse ?? originalDoc.warehouse) as Relation)

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  await receive(req, {
    doc: docRef(args),
    date,
    moveType: 'opening',
    lines: lines.map((line) => ({
      product: idOf(line.product),
      warehouse,
      qty: line.quantity,
      valueBani: line.quantity * line.unitCostBani,
    })),
  })
}

/** Сторно як сторно приходу: умовне списання, `qty = 0 ⇒ value = 0`, блок при `value < 0`. */
const reverseOpening = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'opening-balances' },
      docId: { equals: id },
      moveType: { equals: 'opening' },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}

/** Проведення kind=cash: `cash-moves +amount` і `balanceBani += amount` у тій самій транзакції (розд. 3.2). */
const postCashOpening = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.cashLines ?? originalDoc.cashLines ?? []) as CashLine[]

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  await applyCashMoves(req, {
    doc: docRef(args),
    date,
    lines: lines.map((line) => ({ account: idOf(line.account), deltaBani: line.amountBani })),
  })
}

/** Сторно kind=cash: дзеркальні `cash-moves`; якщо з каси вже витрачено, помилка нестачі. */
const reverseCashOpening = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'cash-moves',
    where: { docCollection: { equals: 'opening-balances' }, docId: { equals: id } },
    pagination: false,
    depth: 0,
    req,
  })

  await revertCashMoves(req, { doc: docRef(args), date, moves })
}

const kindOf = ({ data, originalDoc }: Pick<DocumentTransitionArgs, 'data' | 'originalDoc'>) =>
  (data.kind ?? originalDoc.kind ?? 'stock') as Kind

/**
 * Проведення kind=supplierDebt: журналів руху немає, борг рахує `debts.service`. Лише перевіряє,
 * що постачальник не має активного рядка в іншому проведеному документі (дубль подвоїв би борг).
 */
const postSupplierDebt = async (args: DocumentTransitionArgs) => {
  const { req, id, data, originalDoc } = args
  const lines = (data.supplierLines ?? originalDoc.supplierLines ?? []) as SupplierLine[]

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  const suppliers = lines.map((line) => String(idOf(line.supplier)))
  const { docs } = await req.payload.find({
    collection: 'opening-balances',
    where: {
      kind: { equals: 'supplierDebt' },
      status: { equals: 'posted' },
      'supplierLines.supplier': { in: suppliers },
      id: { not_equals: id },
    },
    pagination: false,
    depth: 0,
    req,
  })

  for (const doc of docs) {
    const taken = (doc.supplierLines ?? []).map((line) => String(idOf(line.supplier))).find((s) => suppliers.includes(s))
    if (!taken) continue

    const supplier = await req.payload.findByID({ collection: 'suppliers', id: taken, depth: 0, req })
    throw new APIError(
      customT(req.t)('custom:error:openingSupplierDebtExists', {
        supplier: supplier.name ?? taken,
        document: String(doc.number),
      }),
      409,
      undefined,
      true,
    )
  }
}

/** Замовлення з рядків customerDebt: сирі документи з `paidBani` для перевірок проведення й сторно. */
const loadOrders = async (req: PayloadRequest, ids: string[]) => {
  const model = req.payload.db.collections['orders']
  const session = await requireSession(req)
  const found = await model.collection
    .find<OrderDoc>(
      { _id: { $in: ids.map((id) => new model.base.Types.ObjectId(id)) } },
      { session },
    )
    .toArray()

  return new Map(found.map((order) => [String(order._id), order]))
}

/**
 * Проведення kind=customerDebt: журналів руху немає, `getOrderPayableCapBani` бере суму з проведених
 * рядків. Приймаються лише історичні замовлення (без `stockPostedAt`), не скасовані, а сума не
 * перевищує виручку; одне замовлення має лише один активний рядок у всіх проведених документах.
 */
const postCustomerDebt = async (args: DocumentTransitionArgs) => {
  const { req, id, data, originalDoc } = args
  const lines = (data.customerLines ?? originalDoc.customerLines ?? []) as CustomerLine[]

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  const ids = lines.map((line) => String(idOf(line.order)))
  const orders = await loadOrders(req, ids)
  const reject = (key: CustomTranslationsKeys, order: string, extra: Record<string, string> = {}): never => {
    throw new APIError(customT(req.t)(key, { order, ...extra }), 409, undefined, true)
  }

  for (const line of lines) {
    const orderId = String(idOf(line.order))
    const order = orders.get(orderId)
    if (!order) reject('custom:error:customerDebtOrderNotFound', orderId)

    const number = order?.orderNumber ?? orderId
    if (order?.accounting?.stockPostedAt) reject('custom:error:customerDebtOrderNotHistorical', number)
    if (order?.status === 'cancelled') reject('custom:error:customerDebtOrderCancelled', number)

    const revenue = getOrderRevenueBani(order as PaymentOrder)
    if (line.amountBani > revenue) {
      reject('custom:error:customerDebtExceedsRevenue', number, { revenue: formatMDL(revenue) })
    }
  }

  const { docs } = await req.payload.find({
    collection: 'opening-balances',
    where: {
      kind: { equals: 'customerDebt' },
      status: { equals: 'posted' },
      'customerLines.order': { in: ids },
      id: { not_equals: id },
    },
    pagination: false,
    depth: 0,
    req,
  })

  for (const doc of docs) {
    const taken = (doc.customerLines ?? []).map((line) => String(idOf(line.order))).find((order) => ids.includes(order))
    if (!taken) continue

    reject('custom:error:customerDebtExists', orders.get(taken)?.orderNumber ?? taken, { document: String(doc.number) })
  }
}

/**
 * Сторно kind=customerDebt: оплата замовлення клієнта повертається на його аванс (розд. 6.4) і гасить
 * інші борги, крім замовлень цього документа. Для гостьового замовлення з оплатами сторно заборонене.
 */
const reverseCustomerDebt = async (args: DocumentTransitionArgs) => {
  const { req, originalDoc, date } = args
  const lines = (originalDoc.customerLines ?? []) as CustomerLine[]
  const ids = lines.map((line) => String(idOf(line.order)))
  const orders = await loadOrders(req, ids)

  for (const order of orders.values()) {
    if (order.customer) {
      await releaseOrderPayment(req, { order: String(order._id), customer: String(order.customer), exclude: ids, doc: docRef(args), date })
    } else if ((Number(order.paidBani) || 0) > 0) {
      throw new APIError(
        customT(req.t)('custom:error:customerDebtHasPayments', { order: order.orderNumber ?? String(order._id) }),
        409,
        undefined,
        true,
      )
    }
  }
}

const advanceLinesOf = ({ data, originalDoc }: Pick<DocumentTransitionArgs, 'data' | 'originalDoc'>) =>
  (data.advanceLines ?? originalDoc.advanceLines ?? []) as AdvanceLine[]

/** Проведення kind=customerAdvance: аванс клієнта зростає й одразу гасить його борги (розд. 6.4). */
const postCustomerAdvance = async (args: DocumentTransitionArgs) => {
  const { req, date } = args
  const lines = advanceLinesOf(args)

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  for (const line of lines) {
    await depositToCustomer(req, { customer: String(idOf(line.customer)), amountBani: line.amountBani, kind: 'opening', doc: docRef(args), date })
  }
}

/** Сторно kind=customerAdvance: сума знімається з авансу, а решта з оплат найновіших замовлень клієнта. */
const reverseCustomerAdvance = async (args: DocumentTransitionArgs) => {
  const { req, date } = args

  for (const line of advanceLinesOf(args)) {
    await withdrawFromCustomer(req, { customer: String(idOf(line.customer)), amountBani: line.amountBani, doc: docRef(args), date })
  }
}

const lifecycle = documentLifecycle({
  prefix: 'OPN',
  counterKey: 'openingNumber',
  onPost: (args) => {
    const kind = kindOf(args)
    if (kind === 'cash') return postCashOpening(args)
    if (kind === 'supplierDebt') return postSupplierDebt(args)
    if (kind === 'customerDebt') return postCustomerDebt(args)
    if (kind === 'customerAdvance') return postCustomerAdvance(args)

    return postOpening(args)
  },
  onReverse: (args) => {
    const kind = kindOf(args)
    if (kind === 'cash') return reverseCashOpening(args)
    // supplierDebt: сторно лише змінює статус, і борг перестає враховуватися.
    if (kind === 'supplierDebt') return
    if (kind === 'customerDebt') return reverseCustomerDebt(args)
    if (kind === 'customerAdvance') return reverseCustomerAdvance(args)

    return reverseOpening(args)
  },
})

/**
 * Проведений customerDebt: аванс клієнтів гасить нові борги; сторнований: борг клієнтів зменшується.
 * Після збереження, бо ліміт оплати (`getOrderPayableCapBani`) і борги бачать лише проведені документи.
 */
const settleCustomerDebts: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || doc.kind !== 'customerDebt' || doc.status === previousDoc?.status) return doc
  if (doc.status !== 'posted' && doc.status !== 'reversed') return doc

  const lines = (doc.customerLines ?? []) as CustomerLine[]
  const orders = await loadOrders(req, lines.map((line) => String(idOf(line.order))))
  const customers = new Set([...orders.values()].flatMap((order) => (order.customer ? [String(order.customer)] : [])))
  const ref = { collection: 'opening-balances', id: String(doc.id), number: String(doc.number) }

  for (const customer of customers) {
    if (doc.status === 'posted') {
      await settleCustomer(req, { customer, doc: ref, date: new Date(doc.postedAt ?? Date.now()) })
    } else {
      await refreshCustomerDebt(req, customer)
    }
  }

  return doc
}

/** Один рядок на товар (склад один на документ), на касу, постачальника і замовлення: дубль подвоїв би залишок чи борг. */
const validateOpening: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const kind = kindOf({ data, originalDoc: originalDoc ?? {} })
  const source = (key: string) => (data[key] ?? originalDoc?.[key] ?? []) as unknown[]
  const keys =
    kind === 'cash'
      ? (source('cashLines') as CashLine[]).map((line) => String(idOf(line.account)))
      : kind === 'supplierDebt'
        ? (source('supplierLines') as SupplierLine[]).map((line) => String(idOf(line.supplier)))
        : kind === 'customerDebt'
          ? (source('customerLines') as CustomerLine[]).map((line) => String(idOf(line.order)))
          : kind === 'customerAdvance'
            ? (source('advanceLines') as AdvanceLine[]).map((line) => String(idOf(line.customer)))
            : (source('stockLines') as StockLine[]).map((line) => String(idOf(line.product)))

  if (new Set(keys).size !== keys.length) {
    fail(
      req,
      kind === 'cash'
        ? 'custom:error:openingDuplicateAccount'
        : kind === 'supplierDebt'
          ? 'custom:error:openingSupplierDuplicate'
          : kind === 'customerDebt'
            ? 'custom:error:openingOrderDuplicate'
            : kind === 'customerAdvance'
              ? 'custom:error:openingCustomerDuplicate'
              : 'custom:error:openingDuplicate',
    )
  }

  return data
}

/**
 * Початкові залишки, див. docs/accounting/design.md, розд. 2.2, 10. Борги: supplierDebt (C4),
 * customerDebt (C5); аванси клієнтів: customerAdvance (розд. 6.4).
 */
export const OpeningBalances: CollectionConfig = {
  slug: 'opening-balances',
  labels: collectionLabels('custom:collection:openingBalances:singular', 'custom:collection:openingBalances:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'kind', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:stock'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    beforeChange: [validateOpening, ...lifecycle.hooks.beforeChange],
    afterChange: [settleCustomerDebts],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'kind',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      defaultValue: 'stock',
      options: [
        { label: label('custom:option:openingStock'), value: 'stock' },
        { label: label('custom:option:openingCash'), value: 'cash' },
        { label: label('custom:option:openingSupplierDebt'), value: 'supplierDebt' },
        { label: label('custom:option:openingCustomerDebt'), value: 'customerDebt' },
        { label: label('custom:option:openingCustomerAdvance'), value: 'customerAdvance' },
      ],
    },
    {
      name: 'warehouse',
      label: label('custom:term:warehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: { isActive: { equals: true } },
      admin: { condition: (data) => data?.kind === 'stock' },
    },
    {
      name: 'advanceLines',
      label: label('custom:field:advanceLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'customerAdvance' },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'customer',
              label: label('custom:field:customer'),
              type: 'relationship',
              relationTo: 'users',
              required: true,
              filterOptions: { roles: { in: ['customer'] } },
            },
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
          ],
        },
      ],
    },
    {
      name: 'cashLines',
      label: label('custom:field:cashLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'cash' },
      fields: [
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
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
          ],
        },
      ],
    },
    {
      name: 'supplierLines',
      label: label('custom:field:supplierLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'supplierDebt' },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'supplier',
              label: label('custom:term:supplier'),
              type: 'relationship',
              relationTo: 'suppliers',
              required: true,
              filterOptions: activeSuppliersOnly,
            },
            // Мінус = аванс, який ми сплатили постачальнику наперед.
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, nonZero: true }),
          ],
        },
      ],
    },
    {
      name: 'customerLines',
      label: label('custom:field:customerLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'customerDebt' },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'order', label: label('custom:field:order'), type: 'relationship', relationTo: 'orders', required: true },
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
          ],
        },
      ],
    },
    {
      name: 'stockLines',
      label: label('custom:field:stockLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'stock' },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
            { name: 'quantity', label: label('custom:term:quantity'), type: 'number', required: true, min: 1, validate: validateInteger },
            moneyField({ name: 'unitCostBani', label: label('custom:field:unitCost'), required: true, min: 1 }),
          ],
        },
      ],
    },
  ],
}
