import { CustomOrder } from '@/collections/Orders/types/custom-order'
import { TypedLocale } from 'payload'

export function buildTelegramMessage(
  order: CustomOrder,
  locale: 'all' | TypedLocale | undefined
) {
  const { orderNumber, items, total, shippingAddress, comment } = order

  const products = items
    ?.map((item: any, i: number) => {
      const title = item.title ?? '-'
      const article = item.article ?? '-'
      const qty = item.quantity ?? 0
      const price = item.price ?? 0

      return `${i + 1}️⃣ <b>${title}</b>
  Арт: ${article} | ${qty} × ${price}`
    })
    .join('\n\n')

  return `
<b>🛒 Новый заказ №${orderNumber}</b>

👤 ${shippingAddress.name} (${locale})
📞 +373${shippingAddress.phone}
📧 ${shippingAddress.email}

📍 <b>Доставка:</b>
${shippingAddress.city}, ${shippingAddress.address}

${comment?.trim() ? `💬 <b>Комментарий:</b>\n${comment}\n` : ''}

📦 <b>Товары</b>

${products}

💰 <b>Сумма: ${total} MDL</b>
`
}