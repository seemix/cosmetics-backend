/**
 * Строк резерву (В23). Резерв не знімається сам: після строку замовлення лише потрапляє
 * у віджет дашборда й банер. Усе рахується на льоту, фонових задач немає.
 */
const DAY_MS = 24 * 60 * 60 * 1000

type ExpiryOrder = {
  status?: string | null
  accounting?: { reservedAt?: Date | string | null; reservedItems?: unknown[] | null } | null
} | null | undefined

/** Дійсне число днів ≥ 1; порожнє налаштування означає «без контролю». */
export const normalizeReservationDays = (days: unknown): number | null =>
  typeof days === 'number' && Number.isFinite(days) && days >= 1 ? days : null

/** Момент, з якого резерв вважається простроченим. `null`, якщо дати немає або контролю немає. */
export const expiryDate = (reservedAt: Date | string | null | undefined, days: unknown): Date | null => {
  const normalized = normalizeReservationDays(days)
  if (normalized === null || !reservedAt) return null

  const start = new Date(reservedAt)
  if (Number.isNaN(start.getTime())) return null

  return new Date(start.getTime() + normalized * DAY_MS)
}

/**
 * Резерв прострочений: замовлення в `pending`/`paid` має знімок резерву, і строк минув
 * (рівно N днів ще не прострочено). `backorder` без резерву прострочитись не може.
 */
export const isReservationExpired = (order: ExpiryOrder, days: unknown, now: Date = new Date()): boolean => {
  if (!order || !['pending', 'paid'].includes(order.status ?? '')) return false
  if (!Array.isArray(order.accounting?.reservedItems) || order.accounting.reservedItems.length === 0) return false

  const expires = expiryDate(order.accounting.reservedAt, days)

  return expires !== null && now.getTime() > expires.getTime()
}

/** Межа для запиту: `reservedAt` раніше за цю дату означає прострочений резерв; `null`, якщо контролю немає. */
export const expiredBefore = (days: unknown, now: Date = new Date()): Date | null => {
  const normalized = normalizeReservationDays(days)

  return normalized === null ? null : new Date(now.getTime() - normalized * DAY_MS)
}
