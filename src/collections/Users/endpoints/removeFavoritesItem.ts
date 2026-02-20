import { Endpoint, PayloadRequest } from 'payload'

export const removeFavoritesItem: Endpoint = {
  path: '/favorites/:id',
  method: 'delete',

  handler: async (req: PayloadRequest) => {
    if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
    const { id } = req.routeParams as { id: string }
    const favorites =
      req.user?.favorites?.map(fav =>
        typeof fav === 'string' ? fav : fav.id
      ) || []

    if (!favorites?.includes(id)) return Response.json({ message: 'No such item' })
    await req.payload.update({
      collection: 'users',
      id: req.user.id,
      data: {
        favorites: favorites.filter(fav => fav !== id),
      },
    })
    return Response.json(id)
  },
}