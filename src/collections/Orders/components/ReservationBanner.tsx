import type { UIFieldServerProps } from 'payload'

import { customT } from '@/i18n/labels'
import { expiryDate, isReservationExpired } from '@/services/orders/reservationExpiry'

type Shortage = { product?: unknown; requested?: number; available?: number }

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' ? String((value as { id?: unknown }).id ?? '') || null : value ? String(value) : null

const formatDate = (date: Date): string =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`

const box = (color: string): React.CSSProperties => ({
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) / 2) var(--base)',
  border: `1px solid ${color}`,
  borderRadius: 4,
  color,
})

/**
 * Банер у формі замовлення (В23): «Строк резерву минув DD.MM» для простроченого резерву
 * і перелік нестач для замовлення «Під замовлення». Лише перегляд, у документ нічого не пише.
 */
export const ReservationBanner = async ({ data, i18n, payload, user }: UIFieldServerProps) => {
  const roles = (user as { roles?: string[] } | null)?.roles
  if (!roles?.includes('admin') && !roles?.includes('manager')) return null

  const t = customT(i18n.t)
  const order = data as { status?: string; accounting?: { reservedAt?: string; reservedItems?: unknown[]; shortages?: Shortage[] } }

  if (order?.status === 'backorder') {
    const shortages = order.accounting?.shortages ?? []
    if (shortages.length === 0) return null

    const ids = shortages.map((line) => idOf(line.product)).filter((id): id is string => Boolean(id))
    const products = await payload.find({
      collection: 'products',
      where: { id: { in: ids } },
      pagination: false,
      depth: 0,
      select: { title: true },
    })
    const titles = new Map(products.docs.map((product) => [String(product.id), product.title as string]))

    return (
      <div role="status" style={box('var(--theme-warning-500)')}>
        <strong>{t('custom:reservation:bannerBackorder')}</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 'var(--base)' }}>
          {shortages.map((line, index) => (
            <li key={index}>
              {titles.get(idOf(line.product) ?? '') ?? idOf(line.product)}:{' '}
              {t('custom:reservation:shortageLine', { requested: line.requested ?? 0, available: line.available ?? 0 })}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
  if (!isReservationExpired(order, settings.reservationDays)) return null

  const expires = expiryDate(order.accounting?.reservedAt, settings.reservationDays)
  if (!expires) return null

  return (
    <div role="alert" style={box('var(--theme-error-500)')}>
      {t('custom:reservation:bannerExpired', { date: formatDate(expires) })}
    </div>
  )
}
