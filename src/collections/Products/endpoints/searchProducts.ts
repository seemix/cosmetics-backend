import { sortGenerator } from '@/services/sort-page.service'
import { Endpoint, PayloadRequest } from 'payload'

type SearchProductsQuery = {
  q?: string
  page?: string
  limit?: string
  sort?: string
}

export const searchProducts: Endpoint = {
  path: '/products-search',
  method: 'get' as const,

  handler: async (
    req: PayloadRequest,
  ): Promise<Response> => {
    const {
      q = '',
      page = '1',
      limit = '10',
      sort,
    } = req.query as SearchProductsQuery

    if (!q || q.length < 2) {
      return Response.json({ products: [], pagination: null })
    }
    const brands = await req.payload.find({
      collection: 'brands',
      where: {
        title: { like: q },
      },
      limit: 100,
    })

    const brandIds = brands.docs.map(b => b.id)
    const isWholesaleUser = req.user?.wholesale === true

    const result = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      sort: sortGenerator(sort as string),
      draft: false,
      page: Number(page),
      limit: Number(limit),
      depth: 2,

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
        brand: false,
      },

      where: {
        or: [
          { title: { like: q } },
          { subtitle: { like: q } },
          { article: { like: q } },
          ...(brandIds.length
            ? [{ brand: { in: brandIds } }]
            : []),
        ],
      },
    })
    // @ts-ignore
    const response = {
      products: result.docs.map(doc => ({
        id: doc.id,
        title: doc.title,
        subtitle: doc.subtitle,
        slug: doc.slug,
        gallery: doc.gallery,
        article: doc.article,
        retailPrice: doc.retailPrice,
        action: doc.action,
        bestSeller: doc.bestSeller,
        ...(isWholesaleUser && { wholesalePrice: doc.wholesalePrice }),
      })),
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalDocs: result.totalDocs,
        hasPrevPage: result.hasPrevPage,
        hasNextPage: result.hasNextPage,
      },
    }
    return Response.json(response)
  },
}