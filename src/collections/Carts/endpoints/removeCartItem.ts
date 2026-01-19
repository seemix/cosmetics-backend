import { Endpoint } from 'payload'
import { normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'

type RemoveItemBody = {
  cartId?: string
  productId?: string
}

export const removeCartItem: Endpoint = {
  path: '/remove-item',
  method: 'post',

  handler: async (req) => {
    const { payload, user } = req
    const  body = await (req as any).json()
    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const { cartId, productId } = body as RemoveItemBody
    // 🛡 Базова валідація
    if (!cartId || !productId) {
      return Response.json(
        { message: 'Invalid request body' },
        { status: 400 },
      )
    }

    // 1️⃣ Отримуємо кошик
    const cart = await payload.findByID({
      collection: 'carts',
      id: cartId,
      depth: 1,
    })

    // @ts-ignore
    if (!cart || cart?.customer?.id !== user.id) {
      return Response.json(
        { message: 'Cart not found or forbidden' },
        { status: 403 },
      )
    }

    // 2️⃣ Фільтруємо items
    const filteredItems = (cart.items || []).filter((item: any) => {
      const product =
        typeof item.product === 'string'
          ? item.product
          : item.product.id

      return product !== productId
    })

    // Якщо нічого не змінилось
    if (filteredItems.length === cart.items?.length) {
      return Response.json(
        { message: 'Item not found in cart' },
        { status: 404 },
      )
    }

    // 3️⃣ Оновлюємо кошик (subtotal перераховується hook-ом)
    const updatedCart = await payload.update({
      collection: 'carts',
      id: cartId,
      data: {
        items: filteredItems,
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
