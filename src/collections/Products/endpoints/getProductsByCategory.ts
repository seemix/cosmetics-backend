import { PayloadRequest } from 'payload'

import { getProductsByRelation } from '@/collections/Products/services/productsByRelation.service'

export const getProductsByCategory = {
  path: '/products-category/:slug',
  method: 'get' as const,
  handler: async (req: PayloadRequest): Promise<Response> => {
      const docs = await getProductsByRelation(
      req,
      req.routeParams?.slug as string | undefined,
      {
        relationCollection: 'categories',
        relationField: 'categories',
      }
    )
    return Response.json(docs)
  },
}