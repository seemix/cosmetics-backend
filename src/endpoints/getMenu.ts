import { Endpoint, PayloadRequest } from 'payload'
import { categoriesTree } from '@/services/categoriesTree'

export const getMenu: Endpoint = {
  path: '/menu',
  method: 'get',

  handler: async (req: PayloadRequest): Promise<Response> => {

      const categories = await req.payload.find({
        collection: 'categories',
        locale: req.locale,
        select: {
          generateSlug: false,
        },
        depth: 0,
        limit: 0,
      })

      const brands = await req.payload.find({
        collection: 'brands',
        select: {
          logo: false,
          description: false,
        },
        depth: 0,
        limit: 0,
      })

      const tree = categoriesTree(categories.docs, brands.docs)
      return Response.json(tree)
  },
}