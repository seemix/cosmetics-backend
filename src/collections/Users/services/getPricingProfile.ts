import type { PayloadRequest } from 'payload'
import type { ExcludedBrandItem } from '@/collections/Carts/types/normalizedCart'

export type CustomerPricingProfile = {
  wholesale: boolean
  brandDiscounts: ExcludedBrandItem[]
}

/**
 * Єдина вибірка профілю клієнта для ціноутворення й промокодів:
 * прапорець `wholesale` та персональні знижки по брендах.
 */
export async function getCustomerPricingProfile(
  req: PayloadRequest,
  userId: string,
): Promise<CustomerPricingProfile> {
  const result = await req.payload.find({
    collection: 'users',
    limit: 1,
    depth: 0,
    where: { id: { equals: userId } },
    select: { brandDiscounts: true, wholesale: true },
    req,
  })

  const profile = result.docs[0]

  return {
    wholesale: Boolean(profile?.wholesale),
    brandDiscounts: profile?.brandDiscounts ?? [],
  }
}
