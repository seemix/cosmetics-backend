import { CustomOrder } from '@/collections/Orders/types/custom-order'
import { TypedLocale } from 'payload'

export function buildTelegramMessage(
  order: CustomOrder,
  locale: 'all' | TypedLocale | undefined
) {
  const { orderNumber, items, total, shippingAddress, comment } = order

  const rows = items?.map((item: any, i: number) => {
    const index = String(i + 1).padEnd(2)
    const title = String(item.title ?? '-').slice(0, 24).padEnd(24)
    const qty = String(item.quantity ?? 0).padStart(3)
    const price = String(item.price ?? 0).padStart(4)

    return `${index} ${title} ${qty} ${price}`
  })

  const tableHeader =
    `#  Товар                    Кв  Цена\n` +
    `------------------------------------`

  const table = [tableHeader, ...(rows ?? [])].join('\n')

  return `
<b>🛒 Новый заказ №${orderNumber}</b>

👤 ${shippingAddress.name} (${locale})
📞 +373${shippingAddress.phone}
📧 ${shippingAddress.email}

<b>📍 Доставка:</b> ${shippingAddress.city}, ${shippingAddress.address}
${comment?.trim() ? `<b>💬 Комментарий:</b> ${comment}` : ''}

<b>📦 Товары 👇</b>
<code>
${table}
</code>

<b>💰 Сумма: ${total} MDL</b>
`
}