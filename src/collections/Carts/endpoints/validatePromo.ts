import { Endpoint } from 'payload'
import { fetchGuestCart } from '@/collections/Carts/services/fetchGuestCart.service'
import { applyPromoDiscount } from '@/collections/Carts/services/applyPromoDiscount'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'
import { ExcludedBrandItem } from '@/collections/Carts/types/normalizedCart'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'

export const validatePromo: Endpoint = {
  method: 'post',
  path: '/promo',
  handler: async (req) => {
    const { payload, user } = req

    // 1. Безпечне отримання тіла запиту
    const body = typeof req.json === 'function' ? await req.json() : req.json || req.body
    const { promoCode, items, cartId } = body || {}
    const locale = req.locale

    // 2. Валідація обов'язкового поля
    if (!promoCode) {
      return Response.json({ error: 'Promo code is required' }, { status: 400 })
    }
    let excludeBrands: ExcludedBrandItem[] = []
    let wholesale = false
    if (user?.id) {
      const userBrandDiscounts = await payload.find({
        collection: 'users',
        limit: 1,
        depth: 0,
        where: { id: { equals: user.id } },
        select: { brandDiscounts: true, wholesale: true },
      })
      excludeBrands = userBrandDiscounts.docs[0]?.brandDiscounts ?? []
      wholesale = Boolean(userBrandDiscounts.docs[0]?.wholesale)
    }

    const promoResult = await checkPromoCode({
      payload,
      promoCode,
      wholesale,
      cartId,
    })

    if (!promoResult.success) {
      return Response.json(
        { error: `${promoResult.error}` },
        { status: 400 },
      )
    }

    const { promo } = promoResult

    // 3. Обробка гостьового кошика
    if (items && !cartId) {

      const cart = await fetchGuestCart({ payload, items, locale })
      if (!cart) {
        return Response.json({ error: 'Cart not found or empty' }, { status: 400 })
      }

      const discountCart = applyPromoDiscount({
        cart,
        brandIds: promo.brands as string[],
        discountPercent: promo['discount %'],
      })

      return Response.json(discountCart)
    }

    // 4. Обробка кошика авторизованого/існуючого користувача
    if (!cartId) {
      return Response.json({ error: 'Cart ID or items required' }, { status: 400 })
    }


    const cart = await payload.findByID({
      collection: 'carts',
      id: cartId,
      depth: 1,
    })


    if (!cart) {
      return Response.json({ error: 'Cart not found' }, { status: 404 })
    }

    const normalizedCart = await normalizeCartResponse(payload, cart, locale)

    const userDiscountCart = applyPromoDiscount({
      cart: normalizedCart,
      brandIds: promo.brands as string[],
      discountPercent: promo['discount %'],
      excludeBrands,
    })

    return Response.json(userDiscountCart)
  },
}