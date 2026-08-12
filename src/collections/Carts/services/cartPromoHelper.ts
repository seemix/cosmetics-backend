import { Payload } from 'payload'
import { ExcludedBrandItem, NormalizedCart } from '@/collections/Carts/types/normalizedCart'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'
import { applyPromoDiscount } from '@/collections/Carts/services/applyPromoDiscount'

export async function cartPromoHelper(payload: Payload, user: string, cart: NormalizedCart, promoCode: string): Promise<NormalizedCart | null> {
  const userBrandDiscounts = await payload.find({
    collection: 'users',
    limit: 1,
    depth: 0,
    where: { id: { equals: user } },
    select: { brandDiscounts: true, wholesale: true },
  })
  const wholesale = Boolean(userBrandDiscounts.docs[0]?.wholesale)

  const promoResult = await checkPromoCode({
    payload,
    promoCode,
    wholesale,
    cartId: cart.id,
  })
  if (!promoResult.success) return cart
  let excludeBrands: ExcludedBrandItem[]

  excludeBrands = userBrandDiscounts.docs[0]?.brandDiscounts ?? []

  return applyPromoDiscount({
    cart,
    brandIds: promoResult.promo.brands as string[],
    discountPercent: promoResult.promo['discount %'],
    excludeBrands,
  })
}