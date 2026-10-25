import { Endpoint } from 'payload'
import { normalizeCart } from '@/collections/Carts/services/normalizedCart'

export const clearCart: Endpoint = {
  path: '/clear',
  method: 'post',
  handler: async (req) => {
    const { user } = req
    const locale = req.locale || 'ru'

    if (!user) {
      return Response.json(
        { message: 'Unauthorized' },
        { status: 401 },
      )
    }

    // 1️⃣ Знаходимо кошик користувача
    const cartResult = await req.payload.find({
      collection: 'carts',
      where: {
        customer: { equals: user.id },
      },
      limit: 1,
      depth: 0,
      req,
    })

    const cart = cartResult.docs[0]
    if (!cart) {
      return Response.json({ cart: null })
    }

    // 2️⃣ Очищаємо items
    const updatedCart = await req.payload.update({
      collection: 'carts',
      id: cart.id,
      data: {
        items: [],
      },
      req,
    })

    // 3️⃣ Повертаємо нормалізований кошик (порожній)
    return Response.json(
      normalizeCart(updatedCart, new Map(), locale as 'ru' || 'ro'),
    )
  },
}
