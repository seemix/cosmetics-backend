import { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

export const getSinglePost: Endpoint = {
  path: '/:slug',
  method: 'get' as const,

  handler: async (req: PayloadRequest) => {
    const slug = req.routeParams?.slug as string | undefined
    if(!slug) return Response.json('Not found',  { status: 404 })
    const post = await req.payload.find({
      collection: 'posts' as CollectionSlug,
      locale: req.locale,
      limit: 1,
      where: {
        slug: { equals: slug },
      },
    })
    return Response.json(post.docs[0])
  },
}
