import { transformProduct } from '@/collections/Products/services/productsByRelation.service'
import { Endpoint, PayloadRequest } from 'payload'

export const getSingleProduct: Endpoint = {
  path: '/:identifier', // Змінюємо :slug на загальніший :identifier
  method: 'get' as const,

  handler: async (req: PayloadRequest): Promise<Response> => {
    const identifier = req.routeParams?.identifier as string | undefined
    if (!identifier) {
      return Response.json({ message: 'Identifier is required' }, { status: 400 })
    }

    // Перевіряємо, чи переданий ідентифікатор є ID (наприклад, 24-символьний hex для MongoDB або число)
    const isId = /^[0-9a-fA-F]{24}$/.test(identifier) || /^\d+$/.test(identifier)

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
        // Якщо це ID, шукаємо по id, інакше по slug
        [isId ? 'id' : 'slug']: { equals: identifier },
      },
    })

    const product = result.docs[0]

    if (!product) {
      return Response.json({ message: 'Product not found' }, { status: 404 })
    }

    const formattedProduct = transformProduct(product, req)

    return Response.json(formattedProduct)
  },
}