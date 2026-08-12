import { Payload } from 'payload'
import { normalizeCart } from '@/collections/Carts/services/normalizedCart'
import { NormalizedCart } from '@/collections/Carts/types/normalizedCart'

export type PreviewItem = {
  productId: string
  quantity: number
}

export type FetchGuestCartParams = {
  payload: Payload
  items: PreviewItem[]
  locale?: string
}

export type guestCartItem = {
  id: string
  title: string
  subtitle: string
  slug: string
  brandId: string
  price: number
  quantity: number
  thumbnail: string
  discountedSubtotal?: number
}

export type guestCart = {
  id: string
  subtotal: number
  preSubtotal?: number
  promoDiscount?: number
  items: guestCartItem[]
}

export const fetchGuestCart = async ({
                                       payload,
                                       items,
                                       locale = 'ru',
                                     }: FetchGuestCartParams): Promise<NormalizedCart | null> => {
  if (!Array.isArray(items) || items.length === 0) {
    return null
  }

  // 1️⃣ Фільтрація ID продуктів
  const productIds = items
    .map((i) => i.productId)
    .filter(Boolean)

  if (!productIds.length) {
    return null
  }

  // 2️⃣ Запит продуктів
  const productsResult = await payload.find({
    collection: 'products',
    where: {
      id: { in: productIds },
    },
    locale: 'all',
    depth: 2,
    limit: productIds.length,
  })

  const productsMap = new Map(
    productsResult.docs.map((p: any) => [p.id, p]),
  )

  // 3️⃣ Формування структури кошика
  const formattedItems = items
    .map(({ productId, quantity }) => {
      const product = productsMap.get(productId)
      if (!product) return null

      const price = product.retailPrice ?? 0
      const subtotal = price * quantity

      return {
        product: productId,
        quantity,
        price,
        subtotal,
      }
    })
    .filter(Boolean)

  // 4️⃣ Розрахунок загальної суми
  const subtotal = formattedItems.reduce(
    (sum: number, item: any) => sum + item.subtotal,
    0,
  )

  const cart = {
    id: 'preview',
    subtotal,
    currency: 'MDL',
    status: 'preview',
    items: formattedItems,
  }

  // 5️⃣ Нормалізація
  return normalizeCart(cart, productsMap, locale as 'ru' || 'ro')
}