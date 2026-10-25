import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdmin } from '@/endpoints/stockCacheCheck'
import { runInTransaction } from '@/services/documents/documentLifecycle'
import {
  getOrderPayableCapBani,
  getOrderRevenueBani,
  type PaymentOrder,
} from '@/services/finance/orderPayments.service'
import { requireSession } from '@/services/stock/session'

/**
 * Перевірка й перебудова кешів фінансів з журналів (docs/accounting/design.md, розд. 4.4, 6.1), як
 * `stockCacheCheck` для складу: (a) `cash-accounts.balanceBani` = Σ `cash-moves.deltaBani`,
 * (b) `orders.paidBani` = Σ надходжень − Σ повернень (проведені `cash-operations`). Запускати в
 * неробочий час: проведення, що йдуть паралельно, дають розбіжності, яких насправді немає.
 */

type Session = Awaited<ReturnType<typeof requireSession>>
type ObjectIdLike = { toString(): string }
type Total = { _id: ObjectIdLike; total: number }

export type BalanceDiscrepancy = {
  type: 'balance'
  entity: 'cash-account'
  id: string
  expected: number
  actual: number
}

/** Не розбіжність кешу, а порушення правила каси: виправити можна лише операціями. */
export type NegativeBalanceDiscrepancy = {
  type: 'negativeBalance'
  entity: 'cash-account'
  id: string
  /** Найменше допустиме значення. */
  expected: 0
  actual: number
}

export type OrderPaidDiscrepancy = {
  type: 'orderPaid'
  entity: 'order'
  id: string
  number: string | null
  expected: number
  actual: number
}

export type CashCacheDiscrepancy = BalanceDiscrepancy | NegativeBalanceDiscrepancy | OrderPaidDiscrepancy

const collection = (req: PayloadRequest, slug: string) => req.payload.db.collections[slug]

const toMap = (rows: Total[]) => new Map(rows.map((row) => [String(row._id), row.total]))

/** Порівнює кеші з журналами й повертає розбіжності (нічого не змінює). */
export const checkCashCache = async (req: PayloadRequest, session?: Session): Promise<CashCacheDiscrepancy[]> => {
  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const moves = toMap(
    await collection(req, 'cash-moves')
      .aggregate<Total>([{ $group: { _id: '$account', total: { $sum: '$deltaBani' } } }])
      .session(session ?? null),
  )
  const accounts = await collection(req, 'cash-accounts')
    .collection.find<{ _id: ObjectIdLike; balanceBani?: number; allowNegative?: boolean }>({}, { session })
    .toArray()
  const payments = toMap(
    await collection(req, 'cash-operations')
      .aggregate<Total>([
        { $match: { status: 'posted', type: { $in: ['customer_receipt', 'customer_refund'] }, order: { $ne: null } } },
        {
          $group: {
            _id: '$order',
            total: { $sum: { $cond: [{ $eq: ['$type', 'customer_receipt'] }, '$amountBani', { $multiply: ['$amountBani', -1] }] } },
          },
        },
      ])
      .session(session ?? null),
  )
  const paidOrders = await collection(req, 'orders')
    .collection.find<{ _id: ObjectIdLike; paidBani?: number; orderNumber?: string }>(
      { paidBani: { $nin: [0, null] } },
      { session, projection: { paidBani: 1, orderNumber: 1 } },
    )
    .toArray()

  const discrepancies: CashCacheDiscrepancy[] = []

  for (const account of accounts) {
    const id = String(account._id)
    const expected = moves.get(id) ?? 0
    const actual = account.balanceBani ?? 0

    if (actual !== expected) discrepancies.push({ type: 'balance', entity: 'cash-account', id, expected, actual })
    if (actual < 0 && account.allowNegative !== true) {
      discrepancies.push({ type: 'negativeBalance', entity: 'cash-account', id, expected: 0, actual })
    }
  }

  const numbers = new Map(paidOrders.map((order) => [String(order._id), order.orderNumber ?? null]))
  const actualPaid = new Map(paidOrders.map((order) => [String(order._id), order.paidBani ?? 0]))

  for (const id of new Set([...actualPaid.keys(), ...payments.keys()])) {
    const expected = payments.get(id) ?? 0
    const actual = actualPaid.get(id) ?? 0

    if (actual !== expected) {
      discrepancies.push({ type: 'orderPaid', entity: 'order', id, number: numbers.get(id) ?? null, expected, actual })
    }
  }

  return discrepancies
}

/** Стан оплати від `paidBani` і ліміту, як у `changeOrderPaid`; без боргу історичне замовлення рахується від виручки. */
const paymentStateOf = (paidBani: number, capBani: number, order: PaymentOrder) => {
  const cap = capBani > 0 ? capBani : getOrderRevenueBani(order)

  if (paidBani <= 0) return 'unpaid'
  return paidBani < cap ? 'partial' : 'paid'
}

export type FixCashCacheResult = { fixed: CashCacheDiscrepancy[]; skipped: CashCacheDiscrepancy[] }

/**
 * Перебудовує кеші з журналів в одній транзакції й логує кожну зміну. `balanceBani` виправляється
 * завжди; `paidBani` замовлень лише з `orders: true` (змінює дані замовлень, тож явний прапорець).
 * Від'ємний баланс не виправляється: він потребує операцій, а не перебудови кешу. Замовлення
 * змінюються сирим `updateOne`, як і в `orderPayments.service`, тому хуки Orders не спрацьовують.
 */
export const fixCashCache = (req: PayloadRequest, { orders = false }: { orders?: boolean } = {}): Promise<FixCashCacheResult> =>
  runInTransaction(req, async () => {
    const session = await requireSession(req)
    const result: FixCashCacheResult = { fixed: [], skipped: [] }

    for (const item of await checkCashCache(req, session)) {
      if (item.type === 'balance') {
        await req.payload.update({ collection: 'cash-accounts', id: item.id, data: { balanceBani: item.expected }, depth: 0, req })
      } else if (item.type === 'orderPaid' && orders) {
        const model = collection(req, 'orders')
        const order = await model.collection.findOne<PaymentOrder>(
          { _id: new model.base.Types.ObjectId(item.id) },
          { session },
        )
        if (!order) {
          result.skipped.push(item)
          continue
        }

        const paymentState = paymentStateOf(item.expected, await getOrderPayableCapBani(order, req), order)
        await model.collection.updateOne(
          { _id: new model.base.Types.ObjectId(item.id) },
          { $set: { paidBani: item.expected, paymentState, updatedAt: new Date() } },
          { session },
        )
      } else {
        result.skipped.push(item)
        continue
      }

      req.payload.logger.info({ msg: 'cash cache fixed', ...item })
      result.fixed.push(item)
    }

    return result
  })

export const cashCacheCheck: Endpoint = {
  path: '/cash/cache-check',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const discrepancies = await checkCashCache(req)

    return Response.json({ ok: discrepancies.length === 0, discrepancies })
  },
}

/** `POST /cash/cache-rebuild`; `?orders=true` додатково виправляє `paidBani` замовлень. */
export const cashCacheRebuild: Endpoint = {
  path: '/cash/cache-rebuild',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const { fixed, skipped } = await fixCashCache(req, { orders: req.searchParams?.get('orders') === 'true' })

    return Response.json({ ok: true, fixed, skipped })
  },
}
