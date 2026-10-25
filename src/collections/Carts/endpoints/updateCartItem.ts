import { Endpoint } from 'payload'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'
import { cartPromoHelper } from '@/collections/Carts/services/cartPromoHelper'
import { getCartItemProductId, isCartOwnedBy } from '@/collections/Carts/utilities/cartItem'

export const updateCartItem: Endpoint = {
  path: '/update-item',
  method: 'patch',
  handler: async (req) => {
    const { user } = req

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { item, promoCode } = await (req as any).json()
    const { productId, quantity } = item

    if (!productId || typeof quantity !== 'number') {
      return Response.json({ error: 'Invalid body' }, { status: 400 })
    }

    const res = await req.payload.find({
      collection: 'carts',
      where: {
        customer: { equals: user.id },
      },
      limit: 1,
      req,
    })

    const cart = res.docs[0]

    if (!cart || !isCartOwnedBy(cart, user.id)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const items = (cart.items ?? []).map((item: any) => {
      if (getCartItemProductId(item) !== productId) return item

      return {
        ...item,
        quantity,
      }
    })

    const updatedCart = await req.payload.update({
      collection: 'carts',
      id: cart.id,
      data: { items },
      req,
    })

    const normalized = await normalizeCartResponse(
      req,
      updatedCart,
      req.locale,
    )
    if (promoCode) {
      const cartWithPromoDiscount = await cartPromoHelper(req, req?.user?.id as string, normalized, promoCode)
       return Response.json({ success: true, cart: cartWithPromoDiscount })
    }

    return Response.json({
      success: true,
      cart: normalized,
    })
  },
}
