/**
 * Період звітів на клієнті: календарні дні `YYYY-MM-DD` у часовому поясі звітів (приходить з сервера).
 * Правила збігаються з `ReportParams.period()` у R1: from ≤ to, не більше 400 днів включно.
 */

export const MAX_PERIOD_DAYS = 400

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` і справжня дата (без 2026-02-30). */
export const isDay = (value: string): boolean => {
  if (!DAY.test(value)) return false
  const [year, month, date] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, date))

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

const toDay = (year: number, month: number, date: number) =>
  new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10)

/** Момент як календарний день у поясі `timeZone`. */
export const dayInZone = (now: Date, timeZone: string): string => now.toLocaleDateString('en-CA', { timeZone })

export const addDays = (day: string, days: number): string => {
  const [year, month, date] = day.split('-').map(Number)

  return toDay(year, month, date + days)
}

/** Кількість днів у періоді, обидві межі включно. */
export const daysInclusive = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1

export type PeriodError = 'required' | 'format' | 'order' | 'tooLong'

export const validatePeriod = (from: string, to: string): PeriodError | null => {
  if (!from || !to) return 'required'
  if (!isDay(from) || !isDay(to)) return 'format'
  if (from > to) return 'order'
  if (daysInclusive(from, to) > MAX_PERIOD_DAYS) return 'tooLong'

  return null
}

export const PRESETS = ['thisMonth', 'lastMonth', 'thisQuarter', 'yearToDate'] as const
export type PresetId = (typeof PRESETS)[number]

/**
 * Межі пресета в поясі звітів. `now` передається ззовні (для тестів). Поточні періоди (місяць,
 * квартал, рік) закінчуються сьогодні, минулий місяць повний.
 */
export const presetRange = (preset: PresetId, now: Date, timeZone: string): { from: string; to: string } => {
  const today = dayInZone(now, timeZone)
  const [year, month] = today.split('-').map(Number)

  switch (preset) {
    case 'thisMonth':
      return { from: toDay(year, month, 1), to: today }
    case 'lastMonth':
      return { from: toDay(year, month - 1, 1), to: addDays(toDay(year, month, 1), -1) }
    case 'thisQuarter':
      return { from: toDay(year, Math.floor((month - 1) / 3) * 3 + 1, 1), to: today }
    case 'yearToDate':
      return { from: toDay(year, 1, 1), to: today }
  }
}
