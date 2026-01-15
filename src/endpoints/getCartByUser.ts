import { Endpoint } from 'payload'

import { normalizeCart} from '@/collections/Carts/services/normalizedCart'

export const getCartByUser: Endpoint = {
  path: '/me',
  method: 'get',
  handler: async (req) => {
    const { payload, user } = req
    const locale = req.locale || 'ru'

    if (!user) {
      return Response.json({ cart: null }, { status: 401 })
    }

    // 1️⃣ Отримуємо кошик
    const cartResult = await payload.find({
      collection: 'carts',
      where: {
        customer: { equals: user.id },
      },
      depth: 1,
      limit: 1,
    })

    const cart = cartResult.docs[0]
    if (!cart) {
      return Response.json({ cart: null })
    }

    // 2️⃣ Збираємо product IDs

    // @ts-ignore
    const productIds = cart.items
      .map((item: any) =>
        typeof item.product === 'string'
          ? item.product
          : item.product?.id,
      )
      .filter(Boolean)

    // 3️⃣ Окремий запит до products (ПОВНИЙ)
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

    return Response.json(
      normalizeCart(cart, productsMap, locale),
    )
  },
}
