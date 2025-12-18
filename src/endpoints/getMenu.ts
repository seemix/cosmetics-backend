import { PayloadRequest } from 'payload'
import { categoriesTree } from '@/services/categoriesTree'

export const getMenu = {
  path: '/menu',
  method: 'get' as 'get' | 'delete' | 'options' | 'connect' | 'head' | 'patch' | 'post' | 'put',
  handler: async (req: PayloadRequest): Promise<Response> => {
    try {
      const categories = await req.payload.find({
        collection: 'categories',
        locale: req.locale,
        select: {
          generateSlug: false,
          updatedAt: false,
          createdAt: false
        },
        depth: 0,
        limit: 0,
      })

      const brands = await req.payload.find({
        collection: 'brands',
        select: {
          logo: false,
          description: false,
          generateSlug: false,
          updatedAt: false,
          createdAt: false
        },
        depth: 0,
        limit: 0,
      })

      // Перетворюємо в дерево
      const tree = categoriesTree(categories.docs, brands.docs)
      return Response.json(tree)
    } catch (e) {
      //  next(e);
    }
  },
}