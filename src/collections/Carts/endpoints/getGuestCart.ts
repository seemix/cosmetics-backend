import { Endpoint } from 'payload'
import { fetchGuestCart } from '@/collections/Carts/services/fetchGuestCart.service'
import { cartPromoHelper } from '@/collections/Carts/services/cartPromoHelper'

export const getGuestCart: Endpoint = {
  path: '/guest',
  method: 'post',
  handler: async (req) => {
    const { payload } = req
    const locale = req.locale || 'ru'

    const { items, promoCode } = await req.json?.()

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { error: 'Items array is required' },
        { status: 400 },
      )
    }

    const normalizedCart = await fetchGuestCart({
      payload,
      items,
      locale,
    })

    if (promoCode && normalizedCart) {
      const cartWithPromoDiscount = await cartPromoHelper(payload, req?.user?.id as string, normalizedCart, promoCode)
      return Response.json({ success: true, cart: cartWithPromoDiscount })
    }
    return Response.json({ success: true, cart: normalizedCart })
  },
}