import { Brand } from '@/payload-types'

export type cartItem = {
  id: string;
  quantity: number;
  price: number;
  title: string;
  subtitle: string;
  slug: string;
  thumbnail?: string;
  brandId?: string;

}
export type NormalizedCart = {
  id: string;
  subtotal: number;
  discount?: number;
  preSubtotal?: number;
  promoDiscount?: number;
  items: cartItem[];
  currency?: string;
  status?: string;
}

export type ApplyDiscountParams = {
  cart: NormalizedCart | null
  brandIds?: string[]
  discountPercent: number,
  excludeBrands?: ExcludedBrandItem[] | null
}

export type ExcludedBrandItem = {
  brand: string | Brand // 👈 Додано | Brand
  discountPercent: number
  id?: string | null
}