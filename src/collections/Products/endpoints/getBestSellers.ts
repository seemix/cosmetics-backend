import { Endpoint, PayloadRequest } from 'payload'

export const getBestSellers: Endpoint = {
  path: '/bestsellers',
  method: 'get' as const,

  handler: async (req: PayloadRequest) => {
    const isWholesaleUser = req.user?.wholesale === true
    const result = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      limit: 10,
      depth: 1,
      where: {
        bestSeller: { equals: true },
      },
      select: {
        inventory: false,
        generateSlug: false,
        _status: false,
        brand: false,
        shortDescription: false,
        description: false,
        priceInMDL: false,
        priceInMDLEnabled: false,
        enableVariants: false,
        variants: false,
        ...(!isWholesaleUser ? { wholesalePrice: false } : {}),
        relatedProducts: false,
      },
    })
    return Response.json(result)
  },
}