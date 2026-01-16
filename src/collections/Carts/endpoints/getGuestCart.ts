import { Endpoint } from 'payload'
import { normalizeCart } from '@/collections/Carts/services/normalizedCart'

type PreviewItem = {
  productId: string
  quantity: number
}

export const getGuestCart: Endpoint = {
  path: '/guest',
  method: 'post',
  handler: async (req) => {
    const { payload } = req
    const locale = req.locale || 'ru'

    const items: PreviewItem[] = await req.json?.()

    if (!Array.isArray(items) || items.length === 0) {
      return Response.json(
        { error: 'Items array is required' },
        { status: 400 },
      )
    }

    // 1️⃣ Product IDs
    const productIds = items
      .map((i) => i.productId)
      .filter(Boolean)

    if (!productIds.length) {
      return Response.json({ cart: null })
    }

    // 2️⃣ Fetch products (FULL)
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

    // 3️⃣ Fake cart structure (compatible with normalizeCart)
    const cart = {
      id: 'preview',
      subtotal: 0,
      currency: 'MDL',
      status: 'preview',
      items: items
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
        .filter(Boolean),
    }

    // 4️⃣ Calculate subtotal
    cart.subtotal = cart.items.reduce(
      (sum: number, item: any) => sum + item.subtotal,
      0,
    )

    return Response.json(
      normalizeCart(cart, productsMap, locale),
    )
  },
}
