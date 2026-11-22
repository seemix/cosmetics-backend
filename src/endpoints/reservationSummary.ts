import type { Endpoint, PayloadRequest, Where } from 'payload'

import { checkRole } from '@/access/utilities'
import { expiredBefore } from '@/services/orders/reservationExpiry'

export type ReservationSummary = {
  /** Замовлення в pending/paid із резервом, строк якого минув. */
  expiredCount: number
  backorderCount: number
  /** Позиції stock-balances, де reserved > qty (перепродаж). */
  oversoldCount: number
  /** До 10 найстаріших прострочених резервів. */
  oldestExpired: Array<{ id: string; orderNumber: string | null; reservedAt: string }>
  reservationDays: number | null
}

const OLDEST_LIMIT = 10

/** Зведення про резерви для віджета дашборда (В23). Лише admin і manager, роль перевіряється явно (D7). */
export const getReservationSummary = async (req: PayloadRequest): Promise<ReservationSummary> => {
  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  const reservationDays = typeof settings.reservationDays === 'number' ? settings.reservationDays : null
  const before = expiredBefore(reservationDays)

  // reservedAt очищується разом зі знімком, тож замовлення без резерву сюди не потрапляють.
  const expiredWhere: Where | null = before
    ? {
        and: [
          { status: { in: ['pending', 'paid'] } },
          { 'accounting.reservedAt': { less_than: before.toISOString() } },
        ],
      }
    : null

  const [expired, backorder, oversold] = await Promise.all([
    expiredWhere
      ? req.payload.find({
          collection: 'orders',
          where: expiredWhere,
          sort: 'accounting.reservedAt',
          limit: OLDEST_LIMIT,
          depth: 0,
          select: { orderNumber: true, accounting: { reservedAt: true } },
          req,
        })
      : null,
    req.payload.count({ collection: 'orders', where: { status: { equals: 'backorder' } }, req }),
    // reserved > qty порівнює два поля одного документа: через where це недоступне, тож сирий запит.
    req.payload.db.collections['stock-balances'].countDocuments({
      $expr: { $gt: [{ $ifNull: ['$reserved', 0] }, '$qty'] },
    }),
  ])

  return {
    expiredCount: expired?.totalDocs ?? 0,
    backorderCount: backorder.totalDocs,
    oversoldCount: oversold,
    oldestExpired: (expired?.docs ?? []).map((order) => ({
      id: String(order.id),
      orderNumber: order.orderNumber ?? null,
      reservedAt: new Date(order.accounting?.reservedAt as string).toISOString(),
    })),
    reservationDays,
  }
}

/** `GET /api/orders/reservation-summary` (ендпоінт колекції orders, інакше його перекриває `/orders/:id`): лічильники для віджета «Резерви». */
export const reservationSummary: Endpoint = {
  path: '/reservation-summary',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
    if (!checkRole(['admin', 'manager'], req.user)) return Response.json({ message: 'Forbidden' }, { status: 403 })

    return Response.json(await getReservationSummary(req))
  },
}
