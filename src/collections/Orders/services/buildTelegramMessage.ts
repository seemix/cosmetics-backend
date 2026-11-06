import { CustomOrder } from '@/collections/Orders/types/custom-order'

/** Telegram з `parse_mode: 'HTML'` відхиляє повідомлення з неекранованими `&`, `<`, `>`. */
export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export function buildTelegramMessage(
  order: CustomOrder,
) {
  const { orderNumber, items, total, shippingAddress, paymentType, comment, SRL, promoCodeApplied, discount } = order

  const products = items
    ?.map((item: any, i: number) => {
      const title = escapeHtml(item.title ?? '-')
      const article = escapeHtml(item.article ?? '-')
      const qty = item.quantity ?? 0
      const price = item.price ?? 0

      return `${i + 1}️⃣ <b>${title}</b>
  Арт: ${article} | ${qty} × ${price}`
    })
    .join('\n\n')

  return `
<b>🛒 Новый заказ №${orderNumber}</b>

👤 ${escapeHtml(shippingAddress.name)}
📞 +373${escapeHtml(shippingAddress.phone)}
📧 ${escapeHtml(shippingAddress.email)}
💰 ${paymentType === 'cash' ? 'Наличными' : `По перечислению \nSRL: ${escapeHtml(SRL)}`}

🚚 <b>Доставка:</b>
${escapeHtml(shippingAddress.city)}, ${escapeHtml(shippingAddress.address)}

${comment?.trim() ? `💬 <b>Комментарий:</b>\n${escapeHtml(comment)}\n` : ''}

📦 <b>Товары</b>

${products}

💰 <b>Сумма: ${total} MDL</b>
${promoCodeApplied && discount ? `| 📉 Скидка: ${discount} MDL  🏷️${escapeHtml(promoCodeApplied)} ` : ''}`
}
