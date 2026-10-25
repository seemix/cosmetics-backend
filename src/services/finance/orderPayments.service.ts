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
const REVENUE_EXPR = {
  $ifNull: ['$accounting.revenueBani', { $floor: { $add: [{ $multiply: [{ $ifNull: ['$total', 0] }, 100] }, 0.5] } }],
}
const PAID_EXPR = { $ifNull: ['$paidBani', 0] }

/**
 * Чи може замовлення прийняти надходження. Повертає ключ причини відмови або `null`.
 * C5 додасть сюди «або має проведений customerDebt» для історичних замовлень.
 */
export const canAcceptPayment = (order: PaymentOrder): CustomTranslationsKeys | null => {
  if (order.status === 'cancelled') return 'custom:error:paymentOrderCancelled'
  if (!order.accounting?.stockPostedAt) return 'custom:error:paymentOrderNotPosted'
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
  const refusal = canAcceptPayment(order)
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

  const filter =
    deltaBani > 0
      ? { _id, status: { $ne: 'cancelled' }, $expr: { $lte: [nextPaid, REVENUE_EXPR] } }
      : { _id, $expr: { $gte: [PAID_EXPR, -deltaBani] } }

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
                { case: { $lt: ['$paidBani', REVENUE_EXPR] }, then: 'partial' },
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
    fail(req, 'custom:error:paymentOverpaid', 409, {
      order: number,
      requested: formatMDL(deltaBani),
      remaining: formatMDL(Math.max(getOrderRevenueBani(current) - paid, 0)),
    })
  }

  fail(req, 'custom:error:paymentExceedsPaid', 409, {
    order: number,
    requested: formatMDL(-deltaBani),
    paid: formatMDL(paid),
  })
}
