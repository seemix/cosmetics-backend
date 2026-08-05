import { Endpoint, PayloadRequest } from 'payload'
import { sortGenerator } from '@/services/sortPage.service'
import { formatPaginatedProducts } from '@/collections/Products/services/productsByRelation.service'

type SearchProductsQuery = {
  q?: string
  page?: string
  limit?: string
  sort?: string
}

export const searchProducts: Endpoint = {
  path: '/products-search',
  method: 'get',

  handler: async (req: PayloadRequest): Promise<Response> => {
    const {
      q = '',
      page = '1',
      limit = '12',
      sort,
    } = req.query as SearchProductsQuery

    if (!q || q.length < 2) {
      return Response.json({
        products: [],
        pagination: {
          page: Number(page),
          limit: Number(limit),
          totalPages: 0,
          totalDocs: 0,
          hasNextPage: false,
          hasPrevPage: false,
          nextPage: null,
          prevPage: null,
        },
      })
    }

    // 1. Пошук брендів за запитом
    const brands = await req.payload.find({
      collection: 'brands',
      where: {
        title: { like: q },
      },
      limit: 100,
    })

    const brandIds = brands.docs.map((b) => b.id)

    // 2. Пошук товарів
    const result = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      sort: sortGenerator(sort as string),
      draft: false,
      page: Number(page),
      limit: Number(limit),
      depth: 2, // Потрібно depth: 2, щоб отримати об'єкт brand для перевірки знижки
      select: {
        description: false,
        relatedProducts: false,
        generateSlug: false,
        _status: false,
        priceInMDL: false,
        priceInMDLEnabled: false,
        variants: false,
        shortDescription: false,
        inventory: false,
        categories: false,
      },
      where: {
        or: [
          { title: { like: q } },
          { subtitle: { like: q } },
          { article: { like: q } },
          ...(brandIds.length ? [{ brand: { in: brandIds } }] : []),
        ],
      },
    })

    // 3. Форматування результату через єдиний хелпер
    const response = formatPaginatedProducts(result, req)

    return Response.json(response)
  },
}