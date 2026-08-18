import type { Endpoint, PayloadRequest } from 'payload'
import { calculateProductPrice } from '@/services/price.service'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'

export const createOrder: Endpoint = {
  path: '/create',
  method: 'post',

  handler: async (req: PayloadRequest): Promise<Response> => {
    try {
      const body = typeof req.json === 'function' ? await req.json() : req.json || req.body
      const { items, shippingAddress, comment, paymentType, SRL, promoCode } = body || {}

      if (!items?.length) {
        return Response.json({ error: 'Items are required' }, { status: 400 })
      }

      if (!shippingAddress) {
        return Response.json({ error: 'Shipping address is required' }, { status: 400 })
      }

      const user = req.user
      const isWholesale = user?.wholesale === true

      let promoData = null

      // 1. Валідація промокоду
      if (promoCode) {
        const promoResult = await checkPromoCode({
          payload: req.payload,
          promoCode,
          wholesale: isWholesale,
        })

        if (!promoResult.success) {
          return Response.json({ error: promoResult.error }, { status: 400 })
        }

        promoData = promoResult.promo
      }

      const orderItems = []
      let rawTotal = 0
      let totalDiscountAmount = 0

      const promoBrandIds = promoData?.brands?.map((brand) =>
        typeof brand === 'object' ? brand.id : brand,
      ) ?? []

      const discountPercent = promoData?.['discount %'] ?? 0

      for (const item of items) {
        if (!item.product || !item.quantity) {
          return Response.json({ error: 'Invalid item format' }, { status: 400 })
        }

        const product = await req.payload.findByID({
          collection: 'products',
          id: item.product,
          depth: 1,
        })

        if (!product) {
          return Response.json({ message: `Product not found: ${item.product}` }, { status: 404 })
        }

        const { price, discountPrice } = calculateProductPrice({
          product,
          user,
        })

        const quantity = Number(item.quantity)
        const hasIndividualDiscount = discountPrice !== undefined && discountPrice !== null

        let finalUnitPrice = discountPrice ?? price
        let itemDiscount = 0

        const productBrandId = typeof product.brand === 'object' ? product.brand?.id : product.brand

        // Застосування промокоду
        if (
          promoData &&
          !hasIndividualDiscount &&
          productBrandId &&
          promoBrandIds.includes(productBrandId)
        ) {
          itemDiscount = (price * discountPercent) / 100
          finalUnitPrice = price - itemDiscount
          totalDiscountAmount += itemDiscount * quantity
        }

        // 🎯 Округлюємо ціну за одиницю товару до цілого числа
        finalUnitPrice = Math.round(finalUnitPrice)

        const lineTotal = finalUnitPrice * quantity
        rawTotal += lineTotal

        orderItems.push({
          product: product.id,
          quantity,
          price: finalUnitPrice,
        })
      }

      // 🎯 Округлюємо підсумкові суми
      const roundedTotal = Math.round(rawTotal)
      const roundedDiscount = Math.round(totalDiscountAmount)

      // 2. Створення замовлення в БД
      const createdOrder = await req.payload.create({
        collection: 'orders',
        data: {
          customer: user?.id,
          items: orderItems,
          total: roundedTotal,
          discount: roundedDiscount > 0 ? roundedDiscount : undefined,
          promoCodeApplied: promoData ? promoData.code : undefined,
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