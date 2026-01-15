export function normalizeCart(cart: any, productsMap: Map<string, any>, locale = 'ru') {
  return {
    id: cart.id,
    subtotal: cart.subtotal,
    currency: cart.currency,
    status: cart.status,

    items: cart.items.map((item: any) => {
      const productId =
        typeof item.product === 'string'
          ? item.product
          : item.product?.id

      const product = productsMap.get(productId)

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
        price: item.price,
        quantity: item.quantity,
        thumbnail,
      }
    }),
  }
}

import type { Payload } from 'payload'

export async function normalizeCartResponse(
  payload: Payload,
  cart: any,
  locale = 'ru'
) {
  const productIds = cart.items
    .map((item: any) =>
      typeof item.product === 'string'
        ? item.product
        : item.product?.id
    )
    .filter(Boolean)

  const products = await payload.find({
    collection: 'products',
    where: {
      id: { in: productIds },
    },
    limit: productIds.length,
  })

  const productsMap = new Map(
    products.docs.map((p: any) => [p.id, p])
  )

  return normalizeCart(cart, productsMap, locale)
}