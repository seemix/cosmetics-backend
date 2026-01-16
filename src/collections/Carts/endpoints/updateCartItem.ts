import { Endpoint } from 'payload'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'

export const updateCartItem: Endpoint = {
  path: '/update-item',
  method: 'patch',
  handler: async (req) => {
    const { payload, user } = req

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { productId, quantity } = await (req as any).json()

    if (!productId || typeof quantity !== 'number') {
      return Response.json({ error: 'Invalid body' }, { status: 400 })
    }

    const res = await payload.find({
      collection: 'carts',
      where: {
        customer: { equals: user.id },
      },
      limit: 1,
    })

   const cart = res.docs[0];

    // @ts-ignore
    if (!cart || cart.customer?.id !== user.id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // @ts-ignore
    const items = cart.items.map((item: any) => {
      const itemProductId =
        typeof item.product === 'string'
          ? item.product
          : item.product?.id

      if (itemProductId !== productId) return item

      return {
        ...item,
        quantity,
      }
    })

    const updatedCart = await payload.update({
      collection: 'carts',
      id: cart.id,
      data: { items },
      req,
    })

    const normalized = await normalizeCartResponse(
      payload,
      updatedCart,
      req.locale
    )
    return Response.json({
      success: true,
      cart: normalized,
    })
  },
}
