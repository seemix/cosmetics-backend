import { Endpoint } from 'payload'

import { getOrCreateCart } from '@/collections/Carts/services/getOrCreateCart'
import { addOrUpdateCartItem } from '@/collections/Carts/services/addOrUpdateCartItem'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'

type MergeCartBody = {
  items: {
    product: { id: string };
    quantity: number;
  }[];
};

export const mergeCart: Endpoint = {
  path: '/merge',
  method: 'post',
  handler: async (req) => {
    const { payload, user } = req
    const body = await (req as any).json() as MergeCartBody

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { items } = body

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ cart: null })
    }

    let cart = await getOrCreateCart(payload, user.id)


    for (const item of items) {
      cart = addOrUpdateCartItem(cart, item)
    }

    const updatedCart = await payload.update({
      collection: 'carts',
      id: cart.id,
      data: cart,
    })
    const normalized = await normalizeCartResponse(
      payload,
      updatedCart,
      req.locale,
    )

    return Response.json({
      success: true,
      cart: normalized,
    })
  },
}