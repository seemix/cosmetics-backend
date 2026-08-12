import type { Payload } from 'payload'
import type { PromoCode } from '@/payload-types'

export type CheckPromoCodeParams = {
  payload: Payload
  promoCode: string
  wholesale: boolean
  cartId?: string
}

export type CheckPromoCodeResult =
  | { success: true; promo: PromoCode }
  | { success: false; error: string }

export async function checkPromoCode({
                                       payload,
                                       promoCode,
                                       wholesale = false,
                                     }: CheckPromoCodeParams): Promise<CheckPromoCodeResult> {
  if (!promoCode?.trim()) {
    return { success: false, error: 'Promo code is required' }
  }

  const { docs } = await payload.find({
    collection: 'promo-codes',
    depth: 0,
    where: { code: { equals: promoCode.trim() } },
  })

  const promo = docs[0]

  if (!promo) {
    return { success: false, error: 'Promo not found' }
  }

  if (!promo.isActive) {
    return { success: false, error: 'Promo is not active' }
  }

  if (promo.wholesale !== wholesale) {
    return { success: false, error: 'Promo not valid' }
  }
  if (promo.expirationDate) {
    const dbDate = new Date(promo.expirationDate)
    if (dbDate.getTime() <= Date.now()) {
      return { success: false, error: 'Promo expired' }
    }
  }

  return { success: true, promo }
}