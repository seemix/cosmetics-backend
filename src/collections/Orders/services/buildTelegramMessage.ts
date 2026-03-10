import { CustomOrder } from '@/collections/Orders/types/custom-order'
import { TypedLocale } from 'payload'

export function buildTelegramMessage(order: CustomOrder, locale: 'all' | TypedLocale | undefined) {
  const { orderNumber, items, total, shippingAddress, comment } = order

  const rows = items?.map((item: any, i: number) => {
    const index = String(i + 1).padEnd(3)
    const article = String(item.product.article ?? '-').padEnd(12)
    const title = String(item.product.title ?? '-').padEnd(30)
    const qty = String(item.quantity).padEnd(5)
    const price = String(item.price).padEnd(6)

    return `${index}${article}${title}${qty}${price}`
  })

  const tableHeader =
    `#  Артикул      Товар                         К-во  Цена\n` +
    `----------------------------------------------------------`

  const table = [tableHeader, ...rows].join('\n')

  return `
<b>🛒 Новый заказ №${orderNumber}</b>

<b>👤 Клиент</b>
Имя: ${shippingAddress.name} (${locale})
Телефон: +373${shippingAddress.phone}
Email: ${shippingAddress.email}

<b>📍 Доставка</b>
Город: ${shippingAddress.city}
Адрес: ${shippingAddress.address}

<b>💬 Комментарий</b>
${comment || '-'}

<b>📦 Товары</b>
<code>
${table}
</code>

<b>💰 Сумма:</b> ${total} MDL
`
}