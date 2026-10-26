import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdmin } from '@/endpoints/stockCacheCheck'
import { runInTransaction } from '@/services/documents/documentLifecycle'
import { refreshCustomerDebt } from '@/services/finance/customerBalance.service'
import { getCustomerDebts } from '@/services/finance/debts.service'
import {
  getOrderPayableCapBani,
  getOrderRevenueBani,
  type PaymentOrder,
} from '@/services/finance/orderPayments.service'
import { requireSession } from '@/services/stock/session'

/**
 * Перевірка й перебудова кешів фінансів з журналів (docs/accounting/design.md, розд. 4.4, 6.1), як
 * `stockCacheCheck` для складу: (a) `cash-accounts.balanceBani` = Σ `cash-moves.deltaBani`,
 * (b) `orders.paidBani` = Σ `customer-moves.orderDeltaBani` замовлення (розд. 6.4),
 * (c) `payrolls.paidBani` = Σ проведених виплат зарплати з цим `payroll` (M4),
 * (d) `customer-balances.balanceBani` = Σ `customer-moves.advanceDeltaBani` клієнта,
 * (e) `customer-balances.debtBani` = Σ боргів по замовленнях клієнта, `netBani` = борг − аванс. Запускати в
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

export type PayrollPaidDiscrepancy = {
  type: 'payrollPaid'
  entity: 'payroll'
  id: string
  number: string | null
  expected: number
  actual: number
}

export type CustomerAdvanceDiscrepancy = {
  type: 'customerAdvance'
  entity: 'customer'
  id: string
  expected: number
  actual: number
}

/** `expected`/`actual` — борг; розбіжність і тоді, коли `netBani` ≠ борг − аванс. */
export type CustomerDebtDiscrepancy = {
  type: 'customerDebt'
  entity: 'customer'
  id: string
  expected: number
  actual: number
}

export type CashCacheDiscrepancy =
  | BalanceDiscrepancy
  | NegativeBalanceDiscrepancy
  | OrderPaidDiscrepancy
  | PayrollPaidDiscrepancy
  | CustomerAdvanceDiscrepancy
  | CustomerDebtDiscrepancy

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
    await collection(req, 'customer-moves')
      .aggregate<Total>([
        { $match: { order: { $ne: null } } },
        { $group: { _id: '$order', total: { $sum: '$orderDeltaBani' } } },
      ])
      .session(session ?? null),
  )
  const paidOrders = await collection(req, 'orders')
    .collection.find<{ _id: ObjectIdLike; paidBani?: number; orderNumber?: string }>(
      { paidBani: { $nin: [0, null] } },
      { session, projection: { paidBani: 1, orderNumber: 1 } },
    )
    .toArray()
  const salaryPayments = toMap(
    await collection(req, 'cash-operations')
      .aggregate<Total>([
        { $match: { status: 'posted', type: 'expense', payroll: { $ne: null } } },
        { $group: { _id: '$payroll', total: { $sum: '$amountBani' } } },
      ])
      .session(session ?? null),
  )
  const paidPayrolls = await collection(req, 'payrolls')
    .collection.find<{ _id: ObjectIdLike; paidBani?: number; number?: string }>(
      { paidBani: { $nin: [0, null] } },
      { session, projection: { paidBani: 1, number: 1 } },
    )
    .toArray()

  const advances = toMap(
    await collection(req, 'customer-moves')
      .aggregate<Total>([
        { $match: { customer: { $ne: null } } },
        { $group: { _id: '$customer', total: { $sum: '$advanceDeltaBani' } } },
      ])
      .session(session ?? null),
  )
  const customerBalances = await collection(req, 'customer-balances')
    .collection.find<{ customer: ObjectIdLike; balanceBani?: number; debtBani?: number; netBani?: number }>(
      {},
      { session, projection: { customer: 1, balanceBani: 1, debtBani: 1, netBani: 1 } },
    )
    .toArray()
  const debts = new Map<string, number>()
  for (const debt of await getCustomerDebts(req)) {
    if (debt.customer) debts.set(debt.customer, (debts.get(debt.customer) ?? 0) + debt.debtBani)
  }

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

  const payrollNumbers = new Map(paidPayrolls.map((payroll) => [String(payroll._id), payroll.number ?? null]))
  const actualPayrollPaid = new Map(paidPayrolls.map((payroll) => [String(payroll._id), payroll.paidBani ?? 0]))

  for (const id of new Set([...actualPayrollPaid.keys(), ...salaryPayments.keys()])) {
    const expected = salaryPayments.get(id) ?? 0
    const actual = actualPayrollPaid.get(id) ?? 0

    if (actual !== expected) {
      discrepancies.push({ type: 'payrollPaid', entity: 'payroll', id, number: payrollNumbers.get(id) ?? null, expected, actual })
    }
  }

  const actualAdvance = new Map(customerBalances.map((balance) => [String(balance.customer), balance.balanceBani ?? 0]))

  for (const id of new Set([...actualAdvance.keys(), ...advances.keys()])) {
    const expected = advances.get(id) ?? 0
    const actual = actualAdvance.get(id) ?? 0

    if (actual !== expected) discrepancies.push({ type: 'customerAdvance', entity: 'customer', id, expected, actual })
  }

  const byCustomer = new Map(customerBalances.map((balance) => [String(balance.customer), balance]))

  for (const id of new Set([...byCustomer.keys(), ...debts.keys()])) {
    const balance = byCustomer.get(id)
    const expected = debts.get(id) ?? 0
    const actual = balance?.debtBani ?? 0
    const netMatches = (balance?.netBani ?? 0) === actual - (balance?.balanceBani ?? 0)

    if (actual !== expected || !netMatches) discrepancies.push({ type: 'customerDebt', entity: 'customer', id, expected, actual })
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
 * завжди; `paidBani` замовлень лише з `orders: true` (змінює дані замовлень, тож явний прапорець),
 * `paidBani` розрахунків зарплати лише з `payrolls: true` (сирий `updateOne`, проведений payroll незмінний),
 * аванси, борг і сальдо клієнтів лише з `customers: true`.
 * Від'ємний баланс не виправляється: він потребує операцій, а не перебудови кешу. Замовлення
 * змінюються сирим `updateOne`, як і в `orderPayments.service`, тому хуки Orders не спрацьовують.
 */
export const fixCashCache = (
  req: PayloadRequest,
  {
    orders = false,
    payrolls = false,
    customers = false,
  }: { orders?: boolean; payrolls?: boolean; customers?: boolean } = {},
): Promise<FixCashCacheResult> =>
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
      } else if (item.type === 'payrollPaid' && payrolls) {
        const model = collection(req, 'payrolls')
        await model.collection.updateOne(
          { _id: new model.base.Types.ObjectId(item.id) },
          { $set: { paidBani: item.expected, updatedAt: new Date() } },
          { session },
        )
      } else if (item.type === 'customerAdvance' && customers) {
        const model = collection(req, 'customer-balances')
        const now = new Date()
        await model.collection.updateOne(
          { customer: new model.base.Types.ObjectId(item.id) },
          { $set: { balanceBani: item.expected, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { session, upsert: true },
        )
        // Сальдо залежить від авансу.
        await refreshCustomerDebt(req, item.id)
      } else if (item.type === 'customerDebt' && customers) {
        await refreshCustomerDebt(req, item.id)
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

/**
 * `POST /cash/cache-rebuild`; `?orders=true` додатково виправляє `paidBani` замовлень,
 * `?payrolls=true` — `paidBani` розрахунків зарплати, `?customers=true` — аванси, борг і сальдо клієнтів.
 */
export const cashCacheRebuild: Endpoint = {
  path: '/cash/cache-rebuild',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const { fixed, skipped } = await fixCashCache(req, {
      orders: req.searchParams?.get('orders') === 'true',
      payrolls: req.searchParams?.get('payrolls') === 'true',
      customers: req.searchParams?.get('customers') === 'true',
    })

    return Response.json({ ok: true, fixed, skipped })
  },
}
