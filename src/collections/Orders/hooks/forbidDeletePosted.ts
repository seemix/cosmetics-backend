import { APIError, type CollectionBeforeDeleteHook } from 'payload'

import { customT } from '@/i18n'

/**
 * Проведене замовлення (зі списанням залишку) не видаляється, лише скасовується (дизайн, розд. 9.2).
 * Непроведене видаляється, якщо на нього не посилаються касові операції (В20): інакше оплата
 * лишилась би без замовлення.
 */
export const forbidDeletePosted: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const order = await req.payload.findByID({
    collection: 'orders',
    id,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })

  if (order?.accounting?.stockPostedAt) {
    throw new APIError(customT(req.t)('custom:error:postedOrderNotDeletable'), 409, undefined, true)
  }

  const payments = await req.payload.count({
    collection: 'cash-operations',
    where: { order: { equals: id } },
    overrideAccess: true,
    req,
  })
  if ((Number(order?.paidBani) || 0) > 0 || payments.totalDocs > 0) {
    throw new APIError(customT(req.t)('custom:error:orderWithPaymentsNotDeletable'), 409, undefined, true)
  }
}
