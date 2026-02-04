import { PayloadRequest } from 'payload'

export const getPageBySlug = {
  path: '/:slug',
  method: 'get' as const,
  handler: async (req: PayloadRequest): Promise<Response> => {
    const slug = req.routeParams?.slug as string | undefined
    if (!slug) return Response.json('Not found', { status: 404 })
    const page = await req.payload.find({
      collection: 'pages',
      locale: req.locale,
      where: {
        slug: { equals: slug },
      },
      limit: 1,
      select: {
        generateSlug: false,
      },
    })
    return Response.json(page.docs[0])
  },
}