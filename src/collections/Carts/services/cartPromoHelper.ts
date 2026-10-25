import type { PayloadRequest } from 'payload'
import { NormalizedCart } from '@/collections/Carts/types/normalizedCart'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'
import { applyPromoDiscount } from '@/collections/Carts/services/applyPromoDiscount'
import { getCustomerPricingProfile } from '@/collections/Users/services/getPricingProfile'

export async function cartPromoHelper(req: PayloadRequest, user: string, cart: NormalizedCart, promoCode: string): Promise<NormalizedCart | null> {
  const { wholesale, brandDiscounts } = await getCustomerPricingProfile(req, user)

  const promoResult = await checkPromoCode({
    req,
    promoCode,
    wholesale,
    cartId: cart.id,
  })
  if (!promoResult.success) return cart

  return applyPromoDiscount({
    cart,
    brandIds: promoResult.promo.brands as string[],
    discountPercent: promoResult.promo.discountPercent,
    excludeBrands: brandDiscounts,
  })
}