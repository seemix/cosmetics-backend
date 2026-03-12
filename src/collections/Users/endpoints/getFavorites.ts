import { Endpoint, PayloadRequest } from 'payload'

export const getFavorites: Endpoint = {
  path: '/favorites',
  method: 'get',

  handler: async (req: PayloadRequest) => {
    if (!req.user?.id) return Response.json([])
    const { favorites } = await req.payload.findByID({
      collection: 'users',
      id: req.user.id,
      depth: 0,
    })
    if (favorites?.length === 0 || !favorites) return Response.json({ docs: [] })

    const isWholesaleUser = req.user?.wholesale === true
    const products = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      where: {
        id: {
          in: favorites,
        },
      },
      depth: 1,
      select: {
        brand: false,
        categories: false,
        inventory: false,
        _status: false,
        shortDescription: false,
        description: false,
        priceInMDL: false,
        priceInMDLEnabled: false,
        variants: false,
        relatedProducts: false,
      },
    })
    const sanitizedDocs = products.docs.map((doc) => {

      const gallery = doc.gallery?.map((item: any) => {
        const { image } = item

        return {
          ...item,
          image: {
            id: image?.id,
            url: image?.url,
            alt: image?.alt,
            blurHash: image?.blurHash,

            sizes: {
              thumbnail: image?.sizes?.thumbnail,
              medium: image?.sizes?.medium,
            },
          },
        }
      })

      const { wholesalePrice, ...rest } = doc

      return {
        ...rest,
        ...(isWholesaleUser ? { wholesalePrice } : {}),
        gallery,
      }
    })

    return Response.json({
      ...products,
      docs: sanitizedDocs,
    })

  },
}