/**
 * Межі періоду розрахунку зарплати (M4). Дати в адмінці обираються днем, тож період задається
 * календарними днями магазину, а не точним часом:
 * `from` = 00:00:00.000 дня `periodFrom`, `to` = 23:59:59.999 дня `periodTo` (обидві межі включно)
 * у часовому поясі обліку. Подія рівно на початку першого дня або в останню мілісекунду останнього
 * дня входить у період, на мілісекунду раніше або пізніше вже ні.
 */

/** Той самий пояс, що й для дати касової операції (`cash-operations`). */
export const ACCOUNTING_TIME_ZONE = 'Europe/Chisinau'

/** Календарний день у поясі обліку: `YYYY-MM-DD`. */
export const dayKey = (date: Date | string): string =>
  new Date(date).toLocaleDateString('en-CA', { timeZone: ACCOUNTING_TIME_ZONE })

/** Зсув поясу обліку від UTC у мілісекундах на момент `instant`. */
const offsetAt = (instant: number): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ACCOUNTING_TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)

  return asUtc - Math.floor(instant / 1000) * 1000
}

/** Початок календарного дня `YYYY-MM-DD` у поясі обліку. */
export const startOfDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number)
  const guess = Date.UTC(year, month - 1, date)
  // Друга ітерація уточнює зсув, якщо день припадає на перехід літнього часу.
  const first = guess - offsetAt(guess)

  return new Date(guess - offsetAt(first))
}

/** Остання мілісекунда календарного дня `YYYY-MM-DD` у поясі обліку. */
export const endOfDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)

  return new Date(startOfDay(next).getTime() - 1)
}

export type PeriodBounds = { from: Date; to: Date }

/** Межі періоду за датами `periodFrom` і `periodTo`, див. конвенцію вище. */
export const periodBounds = (periodFrom: Date | string, periodTo: Date | string): PeriodBounds => ({
  from: startOfDay(dayKey(periodFrom)),
  to: endOfDay(dayKey(periodTo)),
})
