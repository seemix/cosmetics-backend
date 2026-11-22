import type { WidgetServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { checkRole } from '@/access/utilities'
import { getReservationSummary } from '@/endpoints/reservationSummary'
import { customT } from '@/i18n/labels'
import { expiredBefore } from '@/services/orders/reservationExpiry'

const tile: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: '1 1 180px',
  padding: 'var(--base)',
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 4,
  color: 'inherit',
  textDecoration: 'none',
}

/**
 * Віджет дашборда «Резерви» (В23) для admin і manager: прострочені резерви, замовлення «Під замовлення»
 * і позиції з перепродажем. Лічильники рахуються на льоту, посилання ведуть у відфільтрований список.
 */
export const ReservationWidget = async ({ req }: WidgetServerProps) => {
  if (!checkRole(['admin', 'manager'], req.user)) return null

  const t = customT(req.i18n.t)
  const summary = await getReservationSummary(req)
  const adminRoute = req.payload.config.routes.admin
  const before = expiredBefore(summary.reservationDays)
  const isAdmin = checkRole(['admin'], req.user)

  const listURL = (query: Record<string, string>) =>
    `${formatAdminURL({ adminRoute, path: '/collections/orders' })}?${new URLSearchParams(query).toString()}`

  // Фільтр списку замовлень у форматі, який розбирає Payload: where[and][0][status][in]=...
  const expiredHref = before
    ? listURL({
        'where[and][0][status][in]': 'pending,paid',
        'where[and][1][accounting.reservedAt][less_than]': before.toISOString(),
      })
    : null
  const backorderHref = listURL({ 'where[status][equals]': 'backorder' })
  // Звіт залишків лише для admin, manager іде в список залишків.
  const oversoldHref = isAdmin
    ? `${adminRoute === '/' ? '' : adminRoute}/reports?tab=stock`
    : formatAdminURL({ adminRoute, path: '/collections/stock-balances' })

  const tiles: Array<{ key: string; label: string; count: number; href: string | null }> = [
    { key: 'expired', label: t('custom:reservation:widgetExpired'), count: summary.expiredCount, href: expiredHref },
    { key: 'backorder', label: t('custom:reservation:widgetBackorder'), count: summary.backorderCount, href: backorderHref },
    { key: 'oversold', label: t('custom:reservation:widgetOversold'), count: summary.oversoldCount, href: oversoldHref },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--base)', width: '100%' }}>
      <h2 style={{ margin: 0 }}>{t('custom:reservation:widgetTitle')}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {tiles.map(({ key, label, count, href }) => {
          const content = (
            <>
              <span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
              <span>{label}</span>
            </>
          )

          return href ? (
            <a key={key} href={href} id={`reservation-${key}`} style={tile}>
              {content}
            </a>
          ) : (
            <div key={key} id={`reservation-${key}`} style={tile}>
              {content}
            </div>
          )
        })}
      </div>
      {summary.reservationDays === null && <p style={{ margin: 0, opacity: 0.7 }}>{t('custom:reservation:widgetNoControl')}</p>}
    </div>
  )
}
