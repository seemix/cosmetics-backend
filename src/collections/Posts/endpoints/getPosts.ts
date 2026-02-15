import { CollectionSlug, Endpoint, PayloadRequest } from 'payload'

type GetPostsQuery = {
  limit?: string;
  page?: string;
}
export const getPosts: Endpoint = {
  path: '/',
  method: 'get' as const,

  handler: async (req: PayloadRequest): Promise<Response> => {
    const { limit, page } = req.query as GetPostsQuery
    const posts = await req.payload.find({
      collection: 'posts' as CollectionSlug,
      locale: req.locale,
      limit: Number(limit),
      page: Number(page),
      select: {
        content: false,
      },
    })
    return Response.json(posts)
  },
}