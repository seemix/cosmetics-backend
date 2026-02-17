import { Endpoint, PayloadRequest } from 'payload'
import { getNormalizedOrders } from '@/collections/Orders/services/getNormalizedOrders'

export const getMyOrders: Endpoint = {
  method: 'get',
  path: '/my',

  handler: async (req: PayloadRequest) => {

    if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
    const { page } = req.query || 1
    const orders = await req.payload.find({
      collection: 'orders',
      where: { customer: { equals: req.user.id } },
      depth: 2,
      page: Number(page) || 1,
      locale: req.locale,
      fallbackLocale: 'ru',
      req,
      overrideAccess: true,
    });

    const formattedDocs = await getNormalizedOrders(orders.docs, req)

    return Response.json({...orders, docs: formattedDocs})
  },
}