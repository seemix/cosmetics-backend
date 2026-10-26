import { CustomOrder } from '@/collections/Orders/types/custom-order'

export function buildTelegramMessage(
  order: CustomOrder,
) {
  const { orderNumber, items, total, shippingAddress, paymentType, comment, SRL, promoCodeApplied, discount } = order

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

  const phone = shippingAddress?.phone?.trim() ?? ''
  const phoneText = phone.startsWith('+373') ? phone : `+373${phone}`

  const delivery = [shippingAddress?.city, shippingAddress?.address]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')

  return `
<b>🛒 Новый заказ №${orderNumber}</b>

👤 ${shippingAddress?.name}
📞 ${phoneText}
📧 ${shippingAddress?.email}
💰 ${paymentType === 'cash' ? 'Наличными' : `По перечислению \nSRL: ${SRL}`}

${delivery ? `🚚 <b>Доставка:</b>\n${delivery}\n\n` : ''}${comment?.trim() ? `💬 <b>Комментарий:</b>\n${comment}\n` : ''}

📦 <b>Товары</b>

${products}

💰 <b>Сумма: ${total} MDL</b> 
${promoCodeApplied && discount ? `| 📉 Скидка: ${discount} MDL  🏷️${promoCodeApplied} ` : ''}`
}