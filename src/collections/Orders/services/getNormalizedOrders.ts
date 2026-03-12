import { PayloadRequest } from 'payload'

export const getNormalizedOrders = async (ordersDocs: any, req: PayloadRequest) => {
  const productCache = new Map()

  return await Promise.all(
    ordersDocs.map(async (order: any) => {
      const localizedItems = await Promise.all(
        (order.items || []).map(async (item: any) => {
          const productId = typeof item.product === 'object' ? item.product.id : item.product

          let fullProduct

          // Перевіряємо кеш або робимо запит
          if (productCache.has(productId)) {
            fullProduct = productCache.get(productId)
          } else {
            try {
              fullProduct = await req.payload.findByID({
                collection: 'products',
                id: productId,
                locale: req.locale,
                req,
                depth: 0,
              })
              productCache.set(productId, fullProduct)
            } catch (err) {
              // Якщо продукт видалено, а посилання в замовленні лишилося
              fullProduct = null
            }
          }

          const productData = item.product || {}
          // Безпечне витягування мініатюри
          const firstGalleryItem = productData.gallery?.[0]?.image
          const thumbnail = firstGalleryItem?.sizes?.thumbnail?.url || firstGalleryItem?.url || null

          return {
            id: productId,
            title: fullProduct?.title || productData.title || '',
            subtitle: fullProduct?.subtitle || '',
            article: fullProduct?.article || '',
            slug: fullProduct?.slug || productData.slug || '',
            price: item.price, // Snapshot ціни
            quantity: item.quantity,
            thumbnail,
          }
        }),
      )

      return {
        id: order.id,
        createdAt: order.createdAt,
        orderNumber: order.orderNumber,
        total: order.total,
        status: order.status,
        items: localizedItems,
      }
    }),
  )
}