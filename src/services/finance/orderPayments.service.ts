import { APIError, type PayloadRequest } from 'payload'

import { customT, type CustomTranslationsKeys } from '@/i18n'
import { requireSession } from '@/services/stock/session'
import { formatMDL } from '@/utilities/money'

/**
 * Оплати замовлень (docs/accounting/design.md, розд. 6.2): `paidBani` і `paymentState` змінюються
 * лише тут, сирим умовним `updateOne` у сесії транзакції `req`. Хуки Orders (сповіщення, guard,
 * скасування) при цьому не спрацьовують, а `status` замовлення оплатою не змінюється (В6).
 */

/** Поля замовлення, потрібні для оплати; форма сирого документа MongoDB. */
export type PaymentOrder = {
  _id?: { toString(): string }
  status?: string | null
  total?: number | null
  paidBani?: number | null
  orderNumber?: string | null
  accounting?: { revenueBani?: number | null; stockPostedAt?: Date | string | null } | null
}

const orders = (req: PayloadRequest) => req.payload.db.collections['orders'].collection

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) => new req.payload.db.collections['orders'].base.Types.ObjectId(id)

const fail = (
  req: PayloadRequest,
  key: CustomTranslationsKeys,
  status = 409,
  variables?: Record<string, string>,
): never => {
  throw new APIError(customT(req.t)(key, variables), status, undefined, true)
}

/** База суми замовлення: виручка на момент створення, а для історичних замовлень `total`. */
export const getOrderRevenueBani = (order: PaymentOrder): number =>
  typeof order.accounting?.revenueBani === 'number'
    ? order.accounting.revenueBani
    : Math.round((Number(order.total) || 0) * 100)

/** Та сама база в update pipeline; `floor(x + 0.5)` = `Math.round` для невід'ємних сум. */
export const REVENUE_EXPR = {
  $ifNull: ['$accounting.revenueBani', { $floor: { $add: [{ $multiply: [{ $ifNull: ['$total', 0] }, 100] }, 0.5] } }],
}
export const PAID_EXPR = { $ifNull: ['$paidBani', 0] }

/**
 * Сума, яку замовлення може сплатити (ліміт `paidBani`). Замовлення зі списаним складом: його
 * виручка. Історичне (без `stockPostedAt`): сума його активного (проведеного) `customerDebt`,
 * тобто 0, якщо такого немає, і тоді надходження не приймається (розд. 6.3, 10).
 */
export const getOrderPayableCapBani = async (order: PaymentOrder, req: PayloadRequest): Promise<number> => {
  if (order.accounting?.stockPostedAt) return getOrderRevenueBani(order)

  const session = await requireSession(req)
  const [row] = await req.payload.db.collections['opening-balances']
    .aggregate<{ total: number }>([
      { $match: { kind: 'customerDebt', status: 'posted' } },
      { $unwind: '$customerLines' },
      { $match: { 'customerLines.order': toObjectId(req, String(order._id)) } },
      { $group: { _id: null, total: { $sum: '$customerLines.amountBani' } } },
    ])
    .session(session)

  return row?.total ?? 0
}

/**
 * Чи може замовлення прийняти надходження. Повертає ключ причини відмови або `null`.
 * Історичне замовлення (`capBani` = 0, бо немає проведеного customerDebt) не приймає оплату.
 */
export const canAcceptPayment = (order: PaymentOrder, capBani: number): CustomTranslationsKeys | null => {
  if (order.status === 'cancelled') return 'custom:error:paymentOrderCancelled'
  if (!order.accounting?.stockPostedAt && capBani <= 0) return 'custom:error:paymentOrderNotPosted'
  return null
}

const loadOrder = async (req: PayloadRequest, id: string): Promise<PaymentOrder> => {
  const session = await requireSession(req)
  const order = await orders(req).findOne<PaymentOrder>({ _id: toObjectId(req, id) }, { session })
  if (!order) fail(req, 'custom:error:paymentOrderNotFound', 404)

  return order as PaymentOrder
}

/** Перевірка перед надходженням; читання в сесії транзакції `req`. */
export const assertCanAcceptPayment = async (req: PayloadRequest, id: string) => {
  const order = await loadOrder(req, id)
  const refusal = canAcceptPayment(order, await getOrderPayableCapBani(order, req))
  if (refusal) fail(req, refusal, 409, { order: order.orderNumber ?? id })
}

/**
 * Атомарна зміна `paidBani` на `deltaBani` з перерахунком `paymentState` в тому самому запиті.
 * Збільшення (надходження, сторно повернення): замовлення не скасоване, переплата заборонена.
 * Зменшення (повернення, сторно надходження): сплачено не менше за суму. Умови стоять у фільтрі,
 * тож паралельні оплати не можуть їх порушити; якщо фільтр не спрацював, повертається точна причина.
 */
export const changeOrderPaid = async (req: PayloadRequest, { order, deltaBani }: { order: string; deltaBani: number }) => {
  if (!Number.isInteger(deltaBani) || deltaBani === 0) {
    throw new Error(`Payment delta must be a non-zero whole number of bani, got ${deltaBani}`)
  }

  const session = await requireSession(req)
  const _id = toObjectId(req, order)
  const nextPaid = { $add: [PAID_EXPR, deltaBani] }
  const loaded = await loadOrder(req, order)
  const cap = await getOrderPayableCapBani(loaded, req)

  const filter =
    deltaBani > 0
      ? { _id, status: { $ne: 'cancelled' }, $expr: { $lte: [nextPaid, cap] } }
      : { _id, $expr: { $gte: [PAID_EXPR, -deltaBani] } }

  // Історичне замовлення без customerDebt (лише повернення) рахує стан від виручки, як і раніше.
  const stateCap = cap > 0 ? cap : getOrderRevenueBani(loaded)
  const result = await orders(req).updateOne(
    filter,
    [
      { $set: { paidBani: nextPaid, updatedAt: new Date() } },
      {
        $set: {
          paymentState: {
            $switch: {
              branches: [
                { case: { $lte: ['$paidBani', 0] }, then: 'unpaid' },
                { case: { $lt: ['$paidBani', stateCap] }, then: 'partial' },
              ],
              default: 'paid',
            },
          },
        },
      },
    ],
    { session },
  )
  if (result.modifiedCount > 0) return

  const current = await loadOrder(req, order)
  const number = current.orderNumber ?? order
  const paid = Number(current.paidBani) || 0

  if (deltaBani > 0) {
    if (current.status === 'cancelled') fail(req, 'custom:error:paymentOrderCancelled', 409, { order: number })
    if (!current.accounting?.stockPostedAt && cap <= 0) fail(req, 'custom:error:paymentOrderNotPosted', 409, { order: number })
    fail(req, 'custom:error:paymentOverpaid', 409, {
      order: number,
      requested: formatMDL(deltaBani),
      remaining: formatMDL(Math.max(cap - paid, 0)),
    })
  }

  fail(req, 'custom:error:paymentExceedsPaid', 409, {
    order: number,
    requested: formatMDL(-deltaBani),
    paid: formatMDL(paid),
  })
}
