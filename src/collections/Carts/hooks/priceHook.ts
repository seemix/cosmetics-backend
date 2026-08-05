import { CollectionBeforeChangeHook } from 'payload'
import { calculateProductPrice } from '@/services/price.service'

export const priceHook: CollectionBeforeChangeHook = async ({ data, req, operation }) => {
  if (operation !== 'create' && operation !== 'update') return data
  if (!Array.isArray(data?.items)) return data

  const customerId = typeof data.customer === 'object' ? data.customer?.id : data.customer

  // 🔹 Виправлено типізацію customer
  let customer: any = req.user

  if (customerId && customerId !== req.user?.id) {
    customer = await req.payload.findByID({
      collection: 'users',
      id: customerId,
    })
  }

  const items = await Promise.all(
    data.items.map(async (item: any) => {
      if (!item?.product) return item

      const product =
        typeof item.product === 'string'
          ? await req.payload.findByID({ collection: 'products', id: item.product, depth: 1 })
          : item.product

      const { price, discountPrice } = calculateProductPrice({
        product,
        user: customer,
      })

      const finalPrice = discountPrice ?? price
      const quantity = item.quantity > 0 ? item.quantity : 1

      return {
        ...item,
        price: finalPrice,
        subtotal: finalPrice * quantity,
      }
    }),
  )

  const subtotal = items.reduce((sum, item) => sum + (item.subtotal || 0), 0)

  return { ...data, items, subtotal }
}