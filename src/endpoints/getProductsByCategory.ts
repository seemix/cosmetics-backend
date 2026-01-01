import { PayloadRequest } from 'payload'
import { getProductsByRelation } from '@/services/productsByRelation'

export const getProductsByCategory = {
  path: '/products-category/:slug',
  method: 'get' as const,
  handler: async (req: PayloadRequest): Promise<Response> => {
   // const slug = req.routeParams?.slug
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