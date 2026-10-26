import type { PayloadRequest } from 'payload'

import {
  loadByIds,
  model,
  type ObjectIdLike,
  readSession,
  toObjectId,
  USER_PROJECTION,
  type UserDoc,
} from '@/services/reports/common'
import { getOrderRevenueBani, type PaymentOrder } from '@/services/finance/orderPayments.service'

/**
 * Виписка по клієнту за період (docs/accounting/design.md, розд. 6.5): сальдо на початок, кожна
 * подія, що змінює його борг, і сальдо на кінець; замовлення з рядків періоду мають позиції. Сальдо тут те
 * саме, що `customer-balances.netBani`: Σ нарахованого (замовлення, початкові борги) − Σ оплаченого
 * (надходження, початкові аванси, мінус повернення). Рахується з документів за їхніми датами, тож
 * доступне на будь-яку дату; лише читання, агрегації MongoDB у сесії `req`, якщо вона відкрита.
 */

export type StatementKind =
  | 'order'
  | 'orderCancel'
  | 'openingDebt'
  | 'openingDebtReversal'
  | 'receipt'
  | 'receiptReversal'
  | 'refund'
  | 'refundReversal'
  | 'openingAdvance'
  | 'openingAdvanceReversal'

export type StatementLine = {
  date: string
  kind: StatementKind
  /** Номер документа: замовлення, касова операція, початкові залишки. */
  document: string | null
  /** Замовлення, якого стосується подія (для оплати, якщо його вказано). */
  orderId: string | null
  orderNumber: string | null
  /** Нараховано: плюс збільшує борг клієнта, мінус (скасування, сторно) зменшує. */
  chargedBani: number
  /** Оплачено: плюс зменшує борг, мінус (повернення, сторно оплати) збільшує. */
  paidBani: number
  /** Сальдо після рядка: плюс = клієнт винен нам, мінус = аванс клієнта. */
  balanceBani: number
}

export type StatementItem = { title: string; article: string | null; quantity: number; priceBani: number; amountBani: number }

export type StatementOrder = {
  id: string
  number: string | null
  date: string
  status: string | null
  paymentState: string | null
  totalBani: number
  paidBani: number
  /** Залишок до оплати зараз; у скасованого 0. */
  dueBani: number
  items: StatementItem[]
}

export type CustomerStatement = {
  customer: { id: string; name: string | null; email: string | null; phone: string | null }
  from: string
  to: string
  openingBani: number
  chargedBani: number
  paidBani: number
  closingBani: number
  lines: StatementLine[]
  /** Замовлення, нараховані в періоді (рядки `order` і `openingDebt`), за `id`. */
  orders: Record<string, StatementOrder>
}

type OrderDoc = PaymentOrder & {
  _id: ObjectIdLike
  createdAt?: Date
  updatedAt?: Date
  paymentState?: string | null
  items?: Array<{ product?: ObjectIdLike | null; quantity?: number; price?: number }> | null
  accounting?: PaymentOrder['accounting'] & { cancelledAt?: Date | null }
}

type DocumentDoc = {
  _id: ObjectIdLike
  number?: string
  status: 'posted' | 'reversed'
  postedAt?: Date
  reversedAt?: Date | null
}

type CashDoc = DocumentDoc & {
  type: 'customer_receipt' | 'customer_refund'
  amountBani: number
  operationDate: Date
  order?: ObjectIdLike | null
}

type OpeningDoc = DocumentDoc & {
  customerLines?: Array<{ order: ObjectIdLike; amountBani: number }>
  advanceLines?: Array<{ customer: ObjectIdLike; amountBani: number }>
}

type ProductDoc = { _id: ObjectIdLike; title?: string; article?: string }

type Event = Omit<StatementLine, 'balanceBani'> & { at: Date }

const COUNTED = { $in: ['posted', 'reversed'] }

export const getCustomerStatement = async (
  req: PayloadRequest,
  { customer, from, to, start, end }: { customer: string; from: string; to: string; start: Date; end: Date },
): Promise<CustomerStatement> => {
  const session = await readSession(req)
  const customerId = toObjectId(req, customer)
  const find = <T>(slug: string, filter: Record<string, unknown>) =>
    model(req, slug).collection.find(filter, { session }).toArray() as unknown as Promise<T[]>

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const orders = await find<OrderDoc>('orders', { customer: customerId })
  const orderIds = orders.map((order) => order._id)
  const debts = await find<OpeningDoc>('opening-balances', {
    kind: 'customerDebt',
    status: COUNTED,
    'customerLines.order': { $in: orderIds },
  })
  const payments = await find<CashDoc>('cash-operations', {
    customer: customerId,
    type: { $in: ['customer_receipt', 'customer_refund'] },
    status: COUNTED,
  })
  const advances = await find<OpeningDoc>('opening-balances', {
    kind: 'customerAdvance',
    status: COUNTED,
    'advanceLines.customer': customerId,
  })

  const numbers = new Map(orders.map((order) => [String(order._id), order.orderNumber ?? String(order._id)]))
  const events: Event[] = []
  const add = (at: Date | string | null | undefined, event: Omit<Event, 'at' | 'date'>) => {
    if (!at) return
    const date = new Date(at)
    events.push({ ...event, at: date, date: date.toISOString() })
  }

  /** Активний (проведений, не сторнований) початковий борг замовлення. */
  const activeDebt = new Map<string, number>()

  for (const doc of debts) {
    for (const line of doc.customerLines ?? []) {
      const order = String(line.order)
      if (!numbers.has(order)) continue

      const base = { document: doc.number ?? null, orderId: order, orderNumber: numbers.get(order) ?? null, paidBani: 0 }
      add(doc.postedAt, { ...base, kind: 'openingDebt', chargedBani: line.amountBani })
      if (doc.status === 'reversed') add(doc.reversedAt, { ...base, kind: 'openingDebtReversal', chargedBani: -line.amountBani })
      else activeDebt.set(order, (activeDebt.get(order) ?? 0) + line.amountBani)
    }
  }

  for (const order of orders) {
    const number = order.orderNumber ?? String(order._id)
    const base = { document: number, orderId: String(order._id), orderNumber: number, paidBani: 0 }
    const stockPostedAt = order.accounting?.stockPostedAt

    if (stockPostedAt) {
      const revenue = getOrderRevenueBani(order)
      add(stockPostedAt, { ...base, kind: 'order', chargedBani: revenue })
      if (order.status === 'cancelled') add(order.accounting?.cancelledAt ?? order.updatedAt, { ...base, kind: 'orderCancel', chargedBani: -revenue })
    } else if (order.status === 'cancelled' && activeDebt.has(String(order._id))) {
      // Історичне замовлення не має `cancelledAt`: дата скасування = остання зміна замовлення.
      add(order.updatedAt, { ...base, kind: 'orderCancel', chargedBani: -(activeDebt.get(String(order._id)) ?? 0) })
    }
  }

  for (const doc of payments) {
    const receipt = doc.type === 'customer_receipt'
    const orderId = doc.order ? String(doc.order) : null
    const base = { document: doc.number ?? null, orderId, orderNumber: orderId ? (numbers.get(orderId) ?? null) : null, chargedBani: 0 }
    const sign = receipt ? 1 : -1

    add(doc.operationDate, { ...base, kind: receipt ? 'receipt' : 'refund', paidBani: sign * doc.amountBani })
    if (doc.status === 'reversed') {
      add(doc.reversedAt, { ...base, kind: receipt ? 'receiptReversal' : 'refundReversal', paidBani: -sign * doc.amountBani })
    }
  }

  for (const doc of advances) {
    for (const line of doc.advanceLines ?? []) {
      if (String(line.customer) !== customer) continue

      const base = { document: doc.number ?? null, orderId: null, orderNumber: null, chargedBani: 0 }
      add(doc.postedAt, { ...base, kind: 'openingAdvance', paidBani: line.amountBani })
      if (doc.status === 'reversed') add(doc.reversedAt, { ...base, kind: 'openingAdvanceReversal', paidBani: -line.amountBani })
    }
  }

  // Стабільне сортування: події з однаковою датою лишаються в порядку додавання.
  events.sort((a, b) => a.at.getTime() - b.at.getTime())

  const delta = (event: Pick<Event, 'chargedBani' | 'paidBani'>) => event.chargedBani - event.paidBani
  const openingBani = events.filter((event) => event.at < start).reduce((sum, event) => sum + delta(event), 0)
  let balanceBani = openingBani
  const lines = events
    .filter((event) => event.at >= start && event.at <= end)
    .map(({ at: _at, ...event }) => {
      balanceBani += delta(event)
      return { ...event, balanceBani }
    })

  const charged = new Set(lines.filter((line) => line.kind === 'order' || line.kind === 'openingDebt').map((line) => line.orderId))
  const periodOrders = orders
    .filter((order) => charged.has(String(order._id)))
    .map((order) => ({ order, at: new Date(order.accounting?.stockPostedAt ?? order.createdAt ?? 0) }))

  const products = await loadByIds<ProductDoc>(
    req,
    'products',
    periodOrders.flatMap(({ order }) => (order.items ?? []).map((item) => item.product)),
    { title: 1, article: 1 },
    session,
  )
  const users = await loadByIds<UserDoc & { phone?: string }>(req, 'users', [customerId], { ...USER_PROJECTION, phone: 1 }, session)
  const user = users.get(customer)

  return {
    customer: {
      id: customer,
      name: user ? [user.name, user.surname].filter(Boolean).join(' ') || null : null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },
    from,
    to,
    openingBani,
    chargedBani: lines.reduce((sum, line) => sum + line.chargedBani, 0),
    paidBani: lines.reduce((sum, line) => sum + line.paidBani, 0),
    closingBani: balanceBani,
    lines,
    orders: Object.fromEntries(periodOrders.map(({ order, at }): [string, StatementOrder] => {
      const id = String(order._id)
      const totalBani = getOrderRevenueBani(order)
      const paidBani = Number(order.paidBani) || 0
      const capBani = order.accounting?.stockPostedAt ? totalBani : (activeDebt.get(id) ?? 0)

      const statementOrder: StatementOrder = {
        id,
        number: order.orderNumber ?? null,
        date: at.toISOString(),
        status: order.status ?? null,
        paymentState: order.paymentState ?? null,
        totalBani,
        paidBani,
        dueBani: order.status === 'cancelled' ? 0 : Math.max(capBani - paidBani, 0),
        items: (order.items ?? []).map((item) => {
          const product = item.product ? products.get(String(item.product)) : undefined
          const quantity = Number(item.quantity) || 0
          const priceBani = Math.round((Number(item.price) || 0) * 100)

          return {
            title: product?.title ?? (item.product ? String(item.product) : '—'),
            article: product?.article ?? null,
            quantity,
            priceBani,
            amountBani: priceBani * quantity,
          }
        }),
      }

      return [id, statementOrder]
    })),
  }
}
