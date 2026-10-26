import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook } from 'payload'

import { customT } from '@/i18n'
import { revert } from '@/services/stock/stockLedger.service'

const isCancelTransition = (status: unknown, previousStatus: unknown) =>
  status === 'cancelled' && previousStatus !== 'cancelled'

/**
 * Перевірки скасування до збереження (дизайн, розд. 9.1), щоб відхилене скасування не змінило замовлення.
 * Непроведене замовлення (історичне або облік вимкнено) лише змінює статус.
 * Проведене: оплата гостьового замовлення блокує (спершу повернення клієнту), оплата замовлення
 * клієнта повертається на його аванс (`settleCustomerBalance`); закритий період блокує; інакше `cancelledAt = now`.
 * Хто скасовує: `orders.update` дозволено лише admin (В5); скасувати можна й `shipped`.
 */
export const prepareOrderCancel: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || !originalDoc) return data
  if (!isCancelTransition(data.status, originalDoc.status)) return data

  const stockPostedAt = originalDoc.accounting?.stockPostedAt
  if (!stockPostedAt) return data

  if ((Number(originalDoc.paidBani) || 0) > 0 && !originalDoc.customer) {
    throw new APIError(customT(req.t)('custom:error:paidOrderCancel'), 409, undefined, true)
  }

  const { lockedUntil } = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  if (lockedUntil && new Date(stockPostedAt).getTime() <= new Date(lockedUntil).getTime()) {
    throw new APIError(customT(req.t)('custom:error:periodLocked', { date: String(lockedUntil) }), 409, undefined, true)
  }

  data.accounting = { ...originalDoc.accounting, ...data.accounting, cancelledAt: new Date().toISOString() }

  return data
}

/**
 * Повернення залишку скасованого проведеного замовлення (дизайн, розд. 9.1, 5.3): рухи `sale`
 * сторнуються рухами `sale_cancel` з тими самими кількістю й собівартістю в транзакції `req`.
 * Помилка тут відкочує й зміну статусу. Має йти після `writeOrderStockMoves`, до сповіщень.
 */
export const cancelOrderStock: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !isCancelTransition(doc.status, previousDoc?.status)) return doc
  if (!previousDoc?.accounting?.stockPostedAt) return doc

  const sales = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'orders' },
      docId: { equals: String(doc.id) },
      moveType: { equals: 'sale' },
    },
    pagination: false,
    depth: 0,
    req,
  })
  if (sales.docs.length === 0) return doc

  const cancelledAt = doc.accounting?.cancelledAt
  await revert(req, {
    doc: { collection: 'orders', id: String(doc.id), number: doc.orderNumber ?? undefined },
    date: cancelledAt ? new Date(cancelledAt) : undefined,
    moves: sales.docs,
    moveType: 'sale_cancel',
  })

  return doc
}
