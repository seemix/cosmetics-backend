import type { PayloadRequest } from 'payload'

import type { PeriodBounds } from '@/utilities/period'

import type { PayrollOrderData } from './calculatePayroll'

/**
 * Вибірка замовлень для розрахунку зарплати (docs/accounting/design.md, розд. 7.2): одна агрегація
 * MongoDB у сесії транзакції `req` (якщо вона відкрита), без вибірки всіх замовлень у пам'ять.
 * Межі `from` і `to` включно, див. `periodBounds`.
 */

export type PayrollSelectionScheme = {
  dateBasis: 'order_date' | 'payment_date'
  attribution: 'snapshot' | 'current' | 'creator'
  customerFilter?: 'all' | 'retail' | 'wholesale' | null
}

type ObjectIdLike = { toString(): string }

type OrderRow = Omit<PayrollOrderData, 'id'> & { _id: ObjectIdLike }

const model = (req: PayloadRequest, slug: string) => req.payload.db.collections[slug]

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) => new (model(req, 'orders').base.Types.ObjectId)(id)

/** Сесія транзакції `req` для читання; без відкритої транзакції `undefined`. */
const readSession = async (req: PayloadRequest) => {
  const transactionID = await req.transactionID

  return transactionID === undefined ? undefined : req.payload.db.sessions?.[transactionID]
}

/**
 * Замовлення менеджера за період: проведені (`accounting.stockPostedAt`), не скасовані.
 * - `attribution`: `snapshot` → `orders.manager = M` (індекс `{manager, createdAt}`);
 *   `current` → поточний `users.manager` клієнта = M, гостьові замовлення не входять;
 *   `creator` → замовлення, які оформив M (`orders.createdBy = M`, будь-чий клієнт), і замовлення
 *   сайту, закріплені за M (`source = web`, `orders.manager = M`).
 * - `dateBasis`: `order_date` → `stockPostedAt ∈ [from, to]` (індекс `{accounting.stockPostedAt}`);
 *   `payment_date` → `paymentState = paid` і найпізніша дата надходження грошей на замовлення
 *   (`customer-moves` з `orderDeltaBani > 0`: надходження, зарахування авансу) ∈ [from, to]
 *   (індекс `{order, date}` у `customer-moves`).
 * - `customerFilter`: `retail` → гість або клієнт без `wholesale`; `wholesale` → клієнт з `wholesale`
 *   (поточний стан клієнта).
 */
export const selectPayrollOrders = async (
  req: PayloadRequest,
  { manager, from, to, scheme }: { manager: string } & PeriodBounds & { scheme: PayrollSelectionScheme },
): Promise<PayrollOrderData[]> => {
  const session = await readSession(req)
  const managerId = toObjectId(req, manager)
  const match: Record<string, unknown> = { status: { $ne: 'cancelled' }, 'accounting.stockPostedAt': { $ne: null } }

  if (scheme.attribution === 'snapshot') {
    match.manager = managerId
  } else if (scheme.attribution === 'creator') {
    match.$or = [{ createdBy: managerId }, { source: 'web', manager: managerId }]
  } else {
    // Клієнти менеджера (індекс `users.manager`): їх небагато, а гості відпадають самі.
    const customers = await model(req, 'users')
      .collection.find<{ _id: ObjectIdLike }>({ manager: managerId }, { session, projection: { _id: 1 } })
      .toArray()
    match.customer = { $in: customers.map((customer) => customer._id) }
  }

  const pipeline: Record<string, unknown>[] = []

  if (scheme.dateBasis === 'order_date') {
    match['accounting.stockPostedAt'] = { $ne: null, $gte: from, $lte: to }
    pipeline.push({ $match: match })
  } else {
    match.paymentState = 'paid'
    pipeline.push(
      { $match: match },
      {
        $lookup: {
          from: model(req, 'customer-moves').collection.collectionName,
          localField: '_id',
          foreignField: 'order',
          pipeline: [{ $match: { orderDeltaBani: { $gt: 0 } } }, { $group: { _id: null, at: { $max: '$date' } } }],
          as: 'lastPayment',
        },
      },
      { $match: { 'lastPayment.0.at': { $gte: from, $lte: to } } },
    )
  }

  if (scheme.customerFilter === 'retail' || scheme.customerFilter === 'wholesale') {
    pipeline.push(
      {
        $lookup: {
          from: model(req, 'users').collection.collectionName,
          localField: 'customer',
          foreignField: '_id',
          pipeline: [{ $project: { wholesale: 1 } }],
          as: 'customerDoc',
        },
      },
      // Гість (без клієнта) і клієнт без прапорця дають `wholesale ≠ true`.
      { $match: { 'customerDoc.wholesale': scheme.customerFilter === 'wholesale' ? true : { $ne: true } } },
    )
  }

  pipeline.push(
    { $sort: { 'accounting.stockPostedAt': 1, _id: 1 } },
    {
      $project: {
        orderNumber: 1,
        total: 1,
        paymentState: 1,
        'accounting.revenueBani': 1,
        'accounting.cogsBani': 1,
        'accounting.stockPostedAt': 1,
      },
    },
  )

  const rows = await model(req, 'orders')
    .aggregate<OrderRow>(pipeline as unknown as Parameters<ReturnType<typeof model>['aggregate']>[0])
    .session(session ?? null)

  return rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) }))
}
