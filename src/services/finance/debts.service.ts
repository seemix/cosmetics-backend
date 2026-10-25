import type { PayloadRequest } from 'payload'

import { PAID_EXPR, REVENUE_EXPR } from './orderPayments.service'

/**
 * Борги (docs/accounting/design.md, розд. 6.3). Усе рахується агрегаціями MongoDB без вибірки
 * документів у пам'ять (крім списку боргів покупців, де кожне замовлення і є результатом); у сесії транзакції `req`, якщо вона відкрита.
 */

/** Борг постачальнику: плюс = ми винні йому, мінус = аванс (переплата). Суми в цілих банях. */
export type SupplierDebt = {
  supplier: string
  /** Σ `purchases.lines.amountBani`: товар без розподіленої логістики. */
  goodsBani: number
  /** Σ `purchases.extraCosts.amountBani`, де постачальник є `payee`. */
  extraBani: number
  /** Σ рядків `opening-balances` kind=supplierDebt. */
  openingBani: number
  /** Σ `cash-operations` type=supplier_payment. */
  paidBani: number
  debtBani: number
}

type Part = 'goodsBani' | 'extraBani' | 'openingBani' | 'paidBani'
type Row = { _id: { toString(): string }; total: number }

const model = (req: PayloadRequest, slug: string) => req.payload.db.collections[slug]

type Pipeline = Parameters<ReturnType<typeof model>['aggregate']>[0]

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) => new (model(req, 'suppliers').base.Types.ObjectId)(id)

/** Сесія транзакції `req` для читання; без відкритої транзакції `undefined`. */
const readSession = async (req: PayloadRequest) => {
  const transactionID = await req.transactionID

  return transactionID === undefined ? undefined : req.payload.db.sessions?.[transactionID]
}

/**
 * Чи враховується документ на `asOf`: проведений до цієї дати і не сторнований, або сторнований
 * пізніше за неї. Чернетки не враховуються ніколи.
 */
const countedAsOf = (dateField: 'postedAt' | 'operationDate', asOf: Date) => ({
  status: { $in: ['posted', 'reversed'] },
  [dateField]: { $lte: asOf },
  $or: [{ status: 'posted' }, { reversedAt: { $gt: asOf } }],
})

const sumBy = async (
  req: PayloadRequest,
  slug: string,
  pipeline: Pipeline,
  session: Awaited<ReturnType<typeof readSession>>,
): Promise<Row[]> => model(req, slug).aggregate<Row>(pipeline).session(session ?? null)

/** Σ за постачальниками по чотирьох джерелах; `supplier` обмежує вибірку одним постачальником. */
const collectParts = async (req: PayloadRequest, asOf: Date, supplier?: string) => {
  const session = await readSession(req)
  const only = (field: string) => (supplier ? [{ $match: { [field]: toObjectId(req, supplier) } }] : [])
  const group = (field: string, amount: string) => ({ $group: { _id: `$${field}`, total: { $sum: `$${amount}` } } })

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const parts: Array<[Part, Row[]]> = [
    [
      'goodsBani',
      await sumBy(
        req,
        'purchases',
        [
          { $match: countedAsOf('postedAt', asOf) },
          { $unwind: '$lines' },
          ...only('supplier'),
          group('supplier', 'lines.amountBani'),
        ],
        session,
      ),
    ],
    [
      'extraBani',
      await sumBy(
        req,
        'purchases',
        [
          { $match: countedAsOf('postedAt', asOf) },
          { $unwind: '$extraCosts' },
          ...only('extraCosts.payee'),
          group('extraCosts.payee', 'extraCosts.amountBani'),
        ],
        session,
      ),
    ],
    [
      'openingBani',
      await sumBy(
        req,
        'opening-balances',
        [
          { $match: { kind: 'supplierDebt', ...countedAsOf('postedAt', asOf) } },
          { $unwind: '$supplierLines' },
          ...only('supplierLines.supplier'),
          group('supplierLines.supplier', 'supplierLines.amountBani'),
        ],
        session,
      ),
    ],
    [
      'paidBani',
      await sumBy(
        req,
        'cash-operations',
        [
          { $match: { type: 'supplier_payment', ...countedAsOf('operationDate', asOf) } },
          ...only('supplier'),
          group('supplier', 'amountBani'),
        ],
        session,
      ),
    ],
  ]

  const bySupplier = new Map<string, SupplierDebt>()
  for (const [part, rows] of parts) {
    for (const row of rows) {
      const id = String(row._id)
      const debt = bySupplier.get(id) ?? { supplier: id, goodsBani: 0, extraBani: 0, openingBani: 0, paidBani: 0, debtBani: 0 }
      debt[part] = row.total
      bySupplier.set(id, debt)
    }
  }

  for (const debt of bySupplier.values()) {
    debt.debtBani = debt.goodsBani + debt.extraBani + debt.openingBani - debt.paidBani
  }

  return bySupplier
}

/**
 * Борг постачальнику на `asOf` (за замовчуванням зараз). Береться `amountBani` рядків і
 * `extraCosts`, а не `landedBani`/`allocatedBani`: розподілена логістика інакше пішла б двічі.
 */
export const getSupplierDebt = async (req: PayloadRequest, supplierId: string, asOf = new Date()): Promise<SupplierDebt> => {
  const found = (await collectParts(req, asOf, supplierId)).get(supplierId)

  return found ?? { supplier: supplierId, goodsBani: 0, extraBani: 0, openingBani: 0, paidBani: 0, debtBani: 0 }
}

/** Борги всіх постачальників, що мають хоч один облікований рух на `asOf`. */
export const listSupplierDebts = async (req: PayloadRequest, asOf = new Date()): Promise<SupplierDebt[]> =>
  [...(await collectParts(req, asOf)).values()].sort((a, b) => a.supplier.localeCompare(b.supplier))

/** Борг покупця по замовленню. `customer` порожній для гостьового замовлення. */
export type CustomerDebt = {
  orderId: string
  number: string | null
  customer: string | null
  /** Ліміт оплати: виручка замовлення або сума його активного customerDebt. */
  capBani: number
  paidBani: number
  debtBani: number
}

type DebtRow = { _id: { toString(): string }; orderNumber?: string; customer?: { toString(): string }; capBani: number; paidBani: number }

const toDebt = (row: DebtRow): CustomerDebt => ({
  orderId: String(row._id),
  number: row.orderNumber ?? null,
  customer: row.customer ? String(row.customer) : null,
  capBani: row.capBani,
  paidBani: row.paidBani,
  debtBani: row.capBani - row.paidBani,
})

/**
 * Замовлення з боргом покупця: зі списаним складом (не скасовані) і історичні з активним
 * customerDebt, де `capBani − paidBani > 0`. ЛИШЕ ПОТОЧНИЙ СТАН, без `asOf`: `paidBani` це кеш
 * без історії, на минулу дату його не відновити (на відміну від боргів постачальникам).
 */
export const getCustomerDebts = async (
  req: PayloadRequest,
  { customer }: { customer?: string } = {},
): Promise<CustomerDebt[]> => {
  const session = await readSession(req)
  const customerMatch = (field: string) => (customer ? [{ $match: { [field]: toObjectId(req, customer) } }] : [])
  const projection = { orderNumber: 1, customer: 1, capBani: 1, paidBani: 1 }

  const regular = await model(req, 'orders')
    .aggregate<DebtRow>([
      { $match: { status: { $ne: 'cancelled' }, 'accounting.stockPostedAt': { $ne: null } } },
      ...customerMatch('customer'),
      { $addFields: { capBani: REVENUE_EXPR, paidBani: PAID_EXPR } },
      { $match: { $expr: { $gt: ['$capBani', '$paidBani'] } } },
      { $project: projection },
    ])
    .session(session ?? null)

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const historical = await model(req, 'opening-balances')
    .aggregate<DebtRow>([
      { $match: { kind: 'customerDebt', status: 'posted' } },
      { $unwind: '$customerLines' },
      { $group: { _id: '$customerLines.order', capBani: { $sum: '$customerLines.amountBani' } } },
      { $lookup: { from: model(req, 'orders').collection.collectionName, localField: '_id', foreignField: '_id', as: 'order' } },
      { $unwind: '$order' },
      { $match: { 'order.status': { $ne: 'cancelled' }, 'order.accounting.stockPostedAt': null } },
      ...customerMatch('order.customer'),
      { $addFields: { paidBani: { $ifNull: ['$order.paidBani', 0] }, orderNumber: '$order.orderNumber', customer: '$order.customer' } },
      { $match: { $expr: { $gt: ['$capBani', '$paidBani'] } } },
      { $project: projection },
    ])
    .session(session ?? null)

  return [...regular, ...historical].map(toDebt)
}

/** Підсумок боргів покупців по клієнтах; гості (без `customer`) в одній групі з `customer: null`. */
export type CustomerDebtTotal = { customer: string | null; orders: number; capBani: number; paidBani: number; debtBani: number }

export const getCustomerDebtTotals = async (
  req: PayloadRequest,
  filters: { customer?: string } = {},
): Promise<CustomerDebtTotal[]> => {
  const totals = new Map<string | null, CustomerDebtTotal>()

  for (const debt of await getCustomerDebts(req, filters)) {
    const total = totals.get(debt.customer) ?? { customer: debt.customer, orders: 0, capBani: 0, paidBani: 0, debtBani: 0 }
    total.orders += 1
    total.capBani += debt.capBani
    total.paidBani += debt.paidBani
    total.debtBani += debt.debtBani
    totals.set(debt.customer, total)
  }

  return [...totals.values()]
}
