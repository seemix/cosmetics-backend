import { Endpoint, PayloadRequest } from 'payload'

export const addFavoritesItem: Endpoint = {
  path: '/favorites',
  method: 'post',

  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
    const { id } = await req?.json?.()
    const favorites =
      req.user?.favorites?.map(fav =>
        typeof fav === 'string' ? fav : fav.id,
      ) || []
    if (favorites?.includes(id)) return Response.json({ message: 'Already in favorites' })
    await req.payload.update({
      collection: 'users',
      id: req.user.id,
      data: {
        favorites: [...favorites, id],
      },
    })
    return Response.json(id)
  },
}