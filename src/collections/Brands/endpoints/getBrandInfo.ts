import { Endpoint, PayloadRequest } from 'payload'

export const getBrandInfo: Endpoint = {
  path: '/:slug',
  method: 'get' as const,

  handler: async (req: PayloadRequest) => {
    const slug = await req.routeParams?.slug as string | undefined
    if (!slug) return Response.json('Not found', { status: 404 })
    const brand = await req.payload.find({
      collection: 'brands',
      locale: req.locale,
      limit: 1,
      where: {
        slug: { equals: slug },
      },
    })
    return Response.json(brand.docs[0])
  },
}