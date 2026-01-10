import { CollectionBeforeChangeHook } from 'payload'

export const priceHook: CollectionBeforeChangeHook = async ({
                                                              data,
                                                              req,
                                                              operation,
                                                            }) => {
  if (operation !== 'create' && operation !== 'update') return data
  if (!Array.isArray(data?.items)) return data

  /**
   * 1️⃣ Отримуємо customer
   */
  const customerId =
    typeof data.customer === 'object'
      ? data.customer?.id
      : data.customer

  let isWholesale = false

  if (customerId) {
    const customer = await req.payload.findByID({
      collection: 'users',
      id: customerId,
    })

    isWholesale = customer?.wholesale === true
  }

  /**
   * 2️⃣ Обробка items (з повним захистом)
   */
  const items = await Promise.all(
    data.items.map(async (item: any) => {
      if (!item?.product) return item

      const product =
        typeof item.product === 'string'
          ? await req.payload.findByID({
            collection: 'products',
            id: item.product,
          })
          : item.product

      const basePrice =
        isWholesale && typeof product.wholesalePrice === 'number'
          ? product.wholesalePrice
          : product.retailPrice

      const price =
        typeof basePrice === 'number' && !Number.isNaN(basePrice)
          ? basePrice
          : 0

      const quantity =
        typeof item.quantity === 'number' && item.quantity > 0
          ? item.quantity
          : 1

      const subtotal = price * quantity

      return {
        ...item,
        price: price,
        subtotal,
      }
    }),
  )

  /**
   * 3️⃣ Загальний subtotal кошика
   */
  const subtotal = items.reduce(
    (sum, item) =>
      sum + (typeof item.subtotal === 'number' ? item.subtotal : 0),
    0,
  )

  return {
    ...data,
    items,
    subtotal,
  }
}
