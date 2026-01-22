import { Endpoint } from 'payload'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'
import { getOrCreateCart } from '@/collections/Carts/services/getOrCreateCart'

export const addCartItem: Endpoint = {
  path: '/add-item',
  method: 'post',

  handler: async (req) => {
    const { payload, user } = req
    const { productId, quantity } = await (req as any).json()

    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 })
    }

    if (!productId || typeof quantity !== 'number' || quantity <= 0) {
      return Response.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    // 1️⃣ Отримуємо кошик
    const cart = await getOrCreateCart(payload, user.id);

    // @ts-ignore
    if (!cart || cart.customer.id !== user.id) {
      return Response.json(
        { message: 'Cart not found or forbidden' },
        { status: 403 },
      )
    }

    // 2️⃣ Шукаємо товар у кошику
    const existingItem = cart.items?.find((item: any) => {
      const product =
        typeof item.product === 'string'
          ? item.product
          : item.product.id

      return product === productId
    })

    let updatedItems

    if (existingItem) {
      // 🟦 Збільшуємо кількість
      // @ts-ignore
      updatedItems = cart.items.map((item: any) => {
        const product =
          typeof item.product === 'string'
            ? item.product
            : item.product.id

        return product === productId
          ? { ...item, quantity: item.quantity + quantity }
          : item
      })
    } else {
      // 🟩 Додаємо новий item
      updatedItems = [
        ...(cart.items || []),
        {
          product: productId,
          quantity,
        },
      ]
    }

    // 3️⃣ Оновлюємо кошик (priceHook перераховує subtotal)
    const updatedCart = await payload.update({
      collection: 'carts',
      id: cart.id,
      data: {
        items: updatedItems,
      },
    })
    const normalized = await normalizeCartResponse(
      payload,
      updatedCart,
      req.locale
    )
    return Response.json({
      success: true,
      cart: normalized,
    })
  },
}
