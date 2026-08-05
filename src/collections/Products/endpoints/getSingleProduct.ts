import { Endpoint, PayloadRequest } from 'payload'
import { transformProduct } from '@/collections/Products/services/productsByRelation.service'

export const getSingleProduct: Endpoint = {
  path: '/:slug',
  method: 'get' as const,

  handler: async (req: PayloadRequest): Promise<Response> => {
    const slug = req.routeParams?.slug as string | undefined
    if (!slug) {
      return Response.json({ message: 'Slug is required' }, { status: 400 })
    }

    const result = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      draft: false,
      limit: 1,
      depth: 2,
      select: {
        generateSlug: false,
        _status: false,
        priceInMDL: false,
        priceInMDLEnabled: false,
        titleWithArticle: false,
        inventory: false
      },
      where: {
        slug: { equals: slug },
      },
    })

    const product = result.docs[0]

    if (!product) {
      return Response.json({ message: 'Product not found' }, { status: 404 })
    }

    // 🎯 Застосовуємо ту саму логіку (опт + брендова знижка discountPrice + галерея)
    const formattedProduct = transformProduct(product, req)

    return Response.json(formattedProduct)
  },
}