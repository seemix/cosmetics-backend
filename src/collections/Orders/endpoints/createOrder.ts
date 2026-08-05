import type { Endpoint, PayloadRequest } from 'payload'
import { calculateProductPrice } from '@/services/price.service'

export const createOrder: Endpoint = {
  path: '/create',
  method: 'post',

  handler: async (req: PayloadRequest): Promise<Response> => {
    try {
      const { items, shippingAddress, comment, paymentType, SRL } = await req?.json?.()

      if (!items?.length) {
        return Response.json({ message: 'Items are required' }, { status: 400 })
      }

      if (!shippingAddress) {
        return Response.json({ message: 'Shipping address is required' }, { status: 400 })
      }

      const orderItems = []
      let total = 0
      const user = req.user

      for (const item of items) {
        if (!item.product || !item.quantity) {
          return Response.json({ message: 'Invalid item format' }, { status: 400 })
        }

        const product = await req.payload.findByID({
          collection: 'products',
          id: item.product,
          depth: 1, // depth: 1 необхідний, щоб підтягнути дані бренду для сервісу
        })

        if (!product) {
          return Response.json({ message: `Product not found: ${item.product}` }, { status: 404 })
        }

        // 🎯 Обчислюємо ціну через сервіс
        const { price, discountPrice } = calculateProductPrice({
          product,
          user,
        })

        // Якщо є знижка — беремо discountPrice, інакше стандартну ціну (оптову або роздрібну)
        const finalUnitPrice = discountPrice ?? price
        const quantity = Number(item.quantity)
        const lineTotal = finalUnitPrice * quantity

        total += lineTotal

        orderItems.push({
          product: product.id,
          quantity,
          price: finalUnitPrice,
        })
      }

      const createdOrder = await req.payload.create({
        collection: 'orders',
        data: {
          customer: user?.id,
          items: orderItems,
          total,
          paymentType,
          status: 'pending',
          shippingAddress,
          SRL,
          comment,
        },
        locale: (req.locale as 'ru' | 'ro') || 'ro',
      })

      const order = await req.payload.findByID({
        collection: 'orders',
        id: createdOrder.id,
        depth: 1,
        locale: req.locale,
      })

      const responseOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        items: order.items?.map((item) => {
          const product = typeof item.product === 'object' ? item.product : null

          return {
            title: product?.title,
            article: product?.article,
            subtitle: product?.subtitle,
            quantity: item.quantity,
            price: item.price,
          }
        }),
      }

      return Response.json(
        {
          success: true,
          order: responseOrder,
        },
        { status: 201 },
      )
    } catch (error) {
      console.error('Create order error:', error)
      return Response.json(
        {
          success: false,
          message: 'Failed to create order',
        },
        { status: 500 },
      )
    }
  },
}