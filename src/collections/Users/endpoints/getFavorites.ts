import { withPublishedProducts } from '@/access/publishedProducts'
import { Endpoint, PayloadRequest } from 'payload'
import { canUserReadWholesalePrice } from '@/access/canReadWholesalePrice'

export const getFavorites: Endpoint = {
  path: '/favorites',
  method: 'get',

  handler: async (req: PayloadRequest) => {
    if (!req.user?.id) return Response.json([])
    const { favorites } = await req.payload.findByID({
      collection: 'users',
      id: req.user.id,
      depth: 0,
      req,
    })
    if (favorites?.length === 0 || !favorites) return Response.json({ docs: [] })

    const canSeeWholesalePrice = canUserReadWholesalePrice(req.user)
    const products = await req.payload.find({
      collection: 'products',
      locale: req.locale,
      where: withPublishedProducts({ id: { in: favorites } }, req.user),
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
      req,
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
        ...(canSeeWholesalePrice ? { wholesalePrice } : {}),
        gallery,
      }
    })

    return Response.json({
      ...products,
      docs: sanitizedDocs,
    })

  },
}