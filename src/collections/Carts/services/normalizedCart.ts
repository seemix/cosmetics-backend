import type { PayloadRequest } from 'payload'
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
        brandId: product?.brand?.id,
        price: item.price,
        quantity: item.quantity,
        thumbnail,
      }
    }),
  }
}


export type BuildProductsMapOptions = {
  /** Локаль для `payload.find`. `'all'` повертає всі локалі поля. */
  locale?: 'ru' | 'ro' | 'all'
  /** Глибина populate. `undefined` — дефолт конфігурації. */
  depth?: number
}

/**
 * Єдина побудова `productsMap` для нормалізації кошика.
 * Опції зберігають різну поведінку викликів: `locale: 'all'` + `depth: 2`
 * для гостьового кошика і `/me`, конкретна локаль — для решти.
 */
export async function buildProductsMap(
  req: PayloadRequest,
  productIds: string[],
  options: BuildProductsMapOptions = {},
): Promise<Map<string, any>> {
  const products = await req.payload.find({
    collection: 'products',
    where: {
      id: { in: productIds },
    },
    locale: options.locale,
    depth: options.depth,
    limit: productIds.length,
    req,
  })

  return new Map(products.docs.map((p: any) => [p.id, p]))
}


export async function normalizeCartResponse(
  req: PayloadRequest,
  cart: any,
  locale = 'ru'
) {
  const productIds = getCartProductIds(cart)

  const productsMap = await buildProductsMap(req, productIds, {
    locale: locale as 'ru' | 'ro',
  })

  return normalizeCart(cart, productsMap, locale as 'ru' | 'ro')
}