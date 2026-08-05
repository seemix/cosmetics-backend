import { Endpoint, PayloadRequest } from 'payload'
import { formatPaginatedProducts } from '@/collections/Products/services/productsByRelation.service'

export const getBestSellers: Endpoint = {
  path: '/bestsellers',
  method: 'get' as const,

  handler: async (req: PayloadRequest): Promise<Response> => {
    const result = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      limit: 10,
      depth: 2, // Ставимо depth: 2, щоб підтягнувся об'єкт brand для розрахунку знижки
      where: {
        bestSeller: { equals: true },
      },
      select: {
        inventory: false,
        generateSlug: false,
        _status: false,
        shortDescription: false,
        description: false,
        priceInMDL: false,
        priceInMDLEnabled: false,
        enableVariants: false,
        variants: false,
        relatedProducts: false,
      },
    })

    // Проганяємо через хелпер: автоматично розрахує знижку та прибере wholesalePrice для звичайних юзерів
    const response = formatPaginatedProducts(result, req)

    return Response.json(response)
  },
}