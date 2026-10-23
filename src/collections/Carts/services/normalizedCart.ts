import type { Payload } from 'payload'
import { getCartItemProductId, getCartProductIds } from '@/collections/Carts/utilities/cartItem'


export function normalizeCart(cart: any, productsMap: Map<string, any>, locale: 'ro' | 'ru' = 'ru') {
  return {
    id: cart.id,
    subtotal: cart.subtotal,

    items: cart.items.map((item: any) => {
      const productId = getCartItemProductId(item)

      const product = productId ? productsMap.get(productId) : undefined

      const thumbnail =
        product?.gallery?.[0]?.image?.sizes?.thumbnail?.url ??
        product?.gallery?.[0]?.image?.thumbnailURL ??
        null

      const subtitle =
        typeof product?.subtitle === 'string'
          ? product.subtitle
          : product?.subtitle?.[locale] ??
          product?.subtitle?.en ??
          ''

      return {
        id: productId,
        title: product?.title ?? '',
        subtitle,
        slug: product?.slug ?? '',
        brandId: product?.brand.id,
        price: item.price,
        quantity: item.quantity,
        thumbnail,
      }
    }),
  }
}


export async function normalizeCartResponse(
  payload: Payload,
  cart: any,
  locale = 'ru'
) {
  const productIds = getCartProductIds(cart)

  const products = await payload.find({
    collection: 'products',
    where: {
      id: { in: productIds },
    },
    locale: locale as 'ru' | 'ro',
    limit: productIds.length,
  })

  const productsMap = new Map(
    products.docs.map((p: any) => [p.id, p])
  )

  return normalizeCart(cart, productsMap, locale as 'ru' | 'ro')
}