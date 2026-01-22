import { PayloadRequest } from 'payload'
import { getProductsByRelation } from '@/services/productsByRelation'

export const getProductsByBrand = {
  path: '/products-brand/:slug',
  method: 'get' as const,
  handler: async (req: PayloadRequest): Promise<Response> => {
    const docs = await getProductsByRelation(
      req,
      req.routeParams?.slug as string | undefined,
      {
        relationCollection: 'brands',
        relationField: 'brand',
      }
    )
    return Response.json(docs)
  },
}