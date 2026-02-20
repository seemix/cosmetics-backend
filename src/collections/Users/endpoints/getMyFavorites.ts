import { Endpoint, PayloadRequest } from 'payload'

export const getMyFavorites: Endpoint = {
  path: '/favorites/my',
  method: 'get',

  handler: async (req: PayloadRequest) => {
    if (!req.user?.id) return Response.json([])
    const { favorites } = await req.payload.findByID({
      collection: 'users',
      id: req.user.id,
      depth: 0,
    })
    if (favorites?.length === 0) return Response.json([])

    const resp =
      favorites?.map(fav =>
        typeof fav === 'string' ? fav : fav.id,
      ) || []

    return Response.json(resp)
  },
}