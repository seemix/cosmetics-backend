import type { CollectionBeforeChangeHook } from 'payload'

import { cents, isOrderEditable, relationID, sameItems } from '@/services/orders/orderState'

export const populatePricesAndTotal: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  // Ціни й сума ставляться при створенні й перераховуються, лише коли в непроведеному
  // неоплаченому замовленні змінились позиції, знижка чи клієнт (В20); інакше їх стереже guardPostedOrder (F6).
  if (operation === 'update') {
    if (!data || !originalDoc || !isOrderEditable(originalDoc)) return data

    if (data.items === undefined) data.items = originalDoc.items
    if (!('customer' in data)) data.customer = originalDoc.customer
    if (!('discount' in data)) data.discount = originalDoc.discount

    const changed =
      !sameItems(data.items, originalDoc.items) ||
      cents(data.discount) !== cents(originalDoc.discount) ||
      relationID(data.customer) !== relationID(originalDoc.customer)
    // Суму окремо від позицій не змінити: вона лише похідна.
    if (!changed) {
      data.total = originalDoc.total
      return data
    }
  } else if (operation !== 'create') {
    return data
  }

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