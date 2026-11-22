import type { CollectionBeforeDeleteHook, PayloadRequest } from 'payload'

import { hasReservation, isOrderPosted, relationID } from '@/services/orders/orderState'
import { release } from '@/services/stock/stockLedger.service'

type OrderLike = Parameters<typeof hasReservation>[0]

/**
 * Знімає знімок резерву непроведеного замовлення (`accounting.reservedItems`, В23) у транзакції `req`.
 * Повертає, чи було що знімати. Помилка `release` (кеш розійшовся) відкочує всю операцію.
 */
export const releaseReservationOf = async (
  req: PayloadRequest,
  order: OrderLike,
): Promise<boolean> => {
  if (isOrderPosted(order) || !hasReservation(order)) return false

  const rows = order!.accounting!.reservedItems as Array<{
    product?: unknown
    warehouse?: unknown
    qty?: unknown
  }>
  await release(
    req,
    rows.map((row) => ({
      product: relationID(row.product) ?? '',
      warehouse: relationID(row.warehouse) ?? '',
      qty: Number(row.qty),
    })),
  )
  return true
}

/**
 * Видалення непроведеного замовлення знімає його резерв (В23) у тій самій транзакції.
 * Має йти після `forbidDeletePosted`: відхилене видалення резерв не знімає.
 */
export const releaseOrderReservation: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const order = await req.payload.findByID({
    collection: 'orders',
    id,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })

  await releaseReservationOf(req, order)
}
