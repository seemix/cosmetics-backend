import { Endpoint } from 'payload'
import { fetchGuestCart } from '@/collections/Carts/services/fetchGuestCart.service'
import { applyPromoDiscount } from '@/collections/Carts/services/applyPromoDiscount'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'
import { ExcludedBrandItem } from '@/collections/Carts/types/normalizedCart'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'
import { isCartOwnedBy } from '@/collections/Carts/utilities/cartItem'
import { getCustomerPricingProfile } from '@/collections/Users/services/getPricingProfile'

export const validatePromo: Endpoint = {
  method: 'post',
  path: '/promo',
  handler: async (req) => {
    const { user } = req

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
      const profile = await getCustomerPricingProfile(req, user.id)
      excludeBrands = profile.brandDiscounts
      wholesale = profile.wholesale
    }

    const promoResult = await checkPromoCode({
      req,
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

      const cart = await fetchGuestCart({ req, items, locale })
      if (!cart) {
        return Response.json({ error: 'Cart not found or empty' }, { status: 400 })
      }

      const discountCart = applyPromoDiscount({
        cart,
        brandIds: promo.brands as string[],
        discountPercent: promo.discountPercent,
      })

      return Response.json(discountCart)
    }

    // 4. Обробка кошика авторизованого/існуючого користувача
    if (!cartId) {
      return Response.json({ error: 'Cart ID or items required' }, { status: 400 })
    }


    const cart = await req.payload.findByID({
      collection: 'carts',
      id: cartId,
      depth: 1,
      // Чужий і неіснуючий кошик дають однакову відповідь (не розкриваємо існування).
      disableErrors: true,
      req,
    })

    if (!cart || !user?.id || !isCartOwnedBy(cart, user.id)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const normalizedCart = await normalizeCartResponse(req, cart, locale)

    const userDiscountCart = applyPromoDiscount({
      cart: normalizedCart,
      brandIds: promo.brands as string[],
      discountPercent: promo.discountPercent,
      excludeBrands,
    })

    return Response.json(userDiscountCart)
  },
}