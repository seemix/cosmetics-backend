import { APIError, type CollectionBeforeDeleteHook } from 'payload'

import { customT } from '@/i18n'

/** Проведене замовлення (зі списанням залишку) не видаляється, лише скасовується (дизайн, розд. 9.2). */
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
}
