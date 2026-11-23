import type { DefaultServerCellComponentProps } from 'payload'

import { customT } from '@/i18n/labels'
import { toBani, formatMDL } from '@/utilities/money'

import './ordersList.css'

type Item = { product?: unknown; quantity?: number | null; price?: number | null }

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' ? String((value as { id?: unknown }).id ?? '') || null : value ? String(value) : null

const money = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return formatMDL(toBani(value))
}

/** Мова контенту товарів за мовою інтерфейсу; для `en` лишається мова за замовчуванням. */
const CONTENT_LOCALES = new Set(['ru', 'ro'])

/**
 * Клітинка «Товари» у списку замовлень: підсумок, що розгортається (accordion) у перелік позицій.
 * Список читає замовлення з `depth: 0`, тож назви товарів дочитуються одним запитом на рядок.
 */
export const OrderItemsCell = async ({ cellData, i18n, payload }: DefaultServerCellComponentProps) => {
  const items: Item[] = Array.isArray(cellData) ? cellData : []
  if (items.length === 0) return <span>—</span>

  const t = customT(i18n.t)
  const ids = [...new Set(items.map((item) => idOf(item.product)).filter((id): id is string => Boolean(id)))]

  const titles = new Map<string, string>()
  const articles = new Map<string, string>()
  if (ids.length > 0) {
    const { docs } = await payload.find({
      collection: 'products',
      where: { id: { in: ids } },
      select: { title: true, article: true },
      depth: 0,
      limit: ids.length,
      pagination: false,
      ...(CONTENT_LOCALES.has(i18n.language) ? { locale: i18n.language as 'ru' | 'ro' } : {}),
    })
    for (const doc of docs) {
      titles.set(String(doc.id), String(doc.title ?? ''))
      articles.set(String(doc.id), String(doc.article ?? ''))
    }
  }

  const units = items.reduce((sum, item) => sum + (typeof item.quantity === 'number' ? item.quantity : 0), 0)

  return (
    <details className="orders-list-items">
      <summary>{t('custom:ordersList:itemsSummary', { count: items.length, units })}</summary>
      <table>
        <tbody>
          {items.map((item, index) => {
            const id = idOf(item.product)
            const title = (id && titles.get(id)) || t('custom:ordersList:unknownProduct')
            const article = (id && articles.get(id)) || '—'
            const quantity = typeof item.quantity === 'number' ? item.quantity : 0
            const price = typeof item.price === 'number' ? item.price : null
            return (
              <tr key={`${id ?? 'item'}-${index}`}>
                <td className="orders-list-items__title">
                  {article} | {title}
                </td>
                <td className="orders-list-items__num">× {quantity}</td>
                <td className="orders-list-items__num">{money(price)}</td>
                <td className="orders-list-items__num">{price === null ? '—' : money(price * quantity)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}
