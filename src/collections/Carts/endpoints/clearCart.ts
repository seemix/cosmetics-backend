import { Endpoint } from 'payload'
import { normalizeCart } from '@/collections/Carts/services/normalizedCart'

export const clearCart: Endpoint = {
  path: '/clear',
  method: 'post',
  handler: async (req) => {
    const { payload, user } = req
    const locale = req.locale || 'ru'

    if (!user) {
      return Response.json(
        { message: 'Unauthorized' },
        { status: 401 },
      )
    }

    // 1️⃣ Знаходимо кошик користувача
    const cartResult = await payload.find({
      collection: 'carts',
      where: {
        customer: { equals: user.id },
      },
      limit: 1,
      depth: 0,
    })

    const cart = cartResult.docs[0]
    if (!cart) {
      return Response.json({ cart: null })
    }

    // 2️⃣ Очищаємо items
    const updatedCart = await payload.update({
      collection: 'carts',
      id: cart.id,
      data: {
        items: [],
      },
    })

    // 3️⃣ Повертаємо нормалізований кошик (порожній)
    return Response.json(
      normalizeCart(updatedCart, new Map(), locale),
    )
  },
}
