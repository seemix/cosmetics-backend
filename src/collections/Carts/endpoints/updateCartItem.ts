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

    const { cartId, productId, quantity } = await (req as any).json()

    if (!cartId || !productId || typeof quantity !== 'number') {
      return Response.json({ error: 'Invalid body' }, { status: 400 })
    }

    const cart = await payload.findByID({
      collection: 'carts',
      id: cartId,
      depth: 0,
    })

    if (!cart || cart.customer !== user.id) {
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
      id: cartId,
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
