import type { Endpoint, PayloadRequest } from 'payload'

export const createOrder: Endpoint = {
  path: '/create',
  method: 'post',

  handler: async (req: PayloadRequest) => {
    try {
      const { items, shippingAddress, comment } = await req?.json?.()
      if (!items?.length) {
        return Response.json({ message: 'Items are required' }, { status: 400 })
      }

      if (!shippingAddress) {
        return Response.json({ message: 'Shipping address is required' }, { status: 400 })
      }

      const orderItems = []
      let total = 0

      for (const item of items) {
        if (!item.product || !item.quantity) {
          return Response.json({ message: 'Invalid item format' }, { status: 400 })
        }

        const product = await req.payload.findByID({
          collection: 'products',
          id: item.product,
        })

        if (!product) {
          return Response.json({ message: `Product not found: ${item.product}` }, { status: 404 })
        }

        const isWholeSale = req.user?.wholesale === true
        const price = isWholeSale ? product.wholesalePrice : product.retailPrice

        const lineTotal = Number(price) * item.quantity
        total += lineTotal

        orderItems.push({
          product: product.id,
          quantity: Number(item.quantity),
          price: Number(price),
        })
      }

      const createdOrder = await req.payload.create({
        collection: 'orders',
        data: {
          customer: req.user?.id,
          items: orderItems,
          total,
          status: 'pending',
          shippingAddress,
          comment
        },
        locale: req.locale as 'ru' || 'ro',
      })

      const order = await req.payload.findByID({
        collection: 'orders',
        id: createdOrder.id,
        depth: 1,
        locale: req.locale,
      });

      const responseOrder = {
        id: order.id,
        orderNumber: order.orderNumber,
        items: order.items?.map((item) => {
          const product = typeof item.product === 'object' ? item.product : null;

          return {
            title: product?.title,
            subtitle: product?.subtitle,
            quantity: item.quantity,
            price: item.price,
          };
        }),
      };
      return Response.json({
        success: true,
        order: responseOrder,
      }, { status: 201 })
    } catch (error) {
      console.error('Create order error:', error)
      return Response.json({
        success: false,
        message: 'Failed to create order',
      }, { status: 500 })
    }
  },
}
