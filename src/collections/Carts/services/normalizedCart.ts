import type { Payload } from 'payload'


export function normalizeCart(cart: any, productsMap: Map<string, any>, locale: 'ro' | 'ru' = 'ru') {
  return {
    id: cart.id,
    subtotal: cart.subtotal,

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
    locale: locale as 'ru' | 'ro',
    limit: productIds.length,
  })

  const productsMap = new Map(
    products.docs.map((p: any) => [p.id, p])
  )

  return normalizeCart(cart, productsMap, locale as 'ru' | 'ro')
}