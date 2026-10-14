import type { CollectionBeforeChangeHook } from 'payload'

export const populatePricesAndTotal: CollectionBeforeChangeHook = async ({ data, req }) => {
  // Перевіряємо, чи є в замовленні клієнт (customer) та товари (items)
  if (!data || !data.items || !Array.isArray(data.items)) {
    return data
  }

  let isWholesale = false

  // Якщо customer вказаний як ID або як об'єкт
  const customerId = typeof data.customer === 'object' ? data.customer?.id : data.customer

  if (customerId) {
    try {
      const userDoc = await req.payload.findByID({
        collection: 'users',
        id: customerId,
        req,
      })
      if (userDoc && (userDoc as any).wholesale === true) {
        isWholesale = true
      }
    } catch (error) {
      req.payload.logger.error(`Could not fetch user for order pricing: ${error}`)
    }
  }

  let calculatedTotal = 0

  // Проходимо по кожному елементу масиву items
  for (const item of data.items) {
    const productId = typeof item.product === 'object' ? item.product?.id : item.product

    if (productId) {
      try {
        const productDoc = await req.payload.findByID({
          collection: 'products',
          id: productId,
          req,
        })

        if (productDoc) {
          // Вибираємо ціну в залежності від того, чи є користувач оптовим.
          const regularPrice = productDoc.retailPrice || 0
          const wholesalePrice = productDoc.wholesalePrice ?? regularPrice

          item.price = isWholesale ? wholesalePrice : regularPrice
        }
      } catch (error) {
        req.payload.logger.error(`Could not fetch product ${productId} for pricing: ${error}`)
      }
    }

    const qty = Number(item.quantity) || 0
    const prc = Number(item.price) || 0
    calculatedTotal += qty * prc
  }

  // Автоматично оновлюємо загальну суму замовлення (з урахуванням знижки, якщо вона є)
  const discount = Number(data.discount) || 0
  data.total = Math.max(0, calculatedTotal - discount)

  return data
}