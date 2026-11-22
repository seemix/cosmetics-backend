import type { Where } from 'payload'

/** Поля, якими керують кнопки швидких фільтрів; решту умов фільтра списку не чіпаємо. */
export const STATUS_FIELD = 'status'
export const DATE_FIELD = 'createdAt'

export const ORDER_STATUSES = ['pending', 'backorder', 'paid', 'shipped', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const DATE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]

/** Межі періоду як ISO-моменти: `from` включно, `to` (якщо є) не включно. */
export type DateRange = { from: string; to?: string }

/** Фільтр списку як групи «АБО» з умовами «І» в кожній (так його будує фільтр Payload). */
const groupsOf = (where: Where | undefined): Where[][] => {
  if (!where || Object.keys(where).length === 0) return [[]]
  if (Array.isArray(where.or)) {
    const groups = where.or.map((group) => (Array.isArray(group.and) ? group.and : [group]))
    return groups.length > 0 ? groups : [[]]
  }
  if (Array.isArray(where.and)) return [where.and]

  return [[where]]
}

const touches = (condition: Where, field: string): boolean => Object.prototype.hasOwnProperty.call(condition, field)

/** Замінює в кожній групі умови поля `field` на `conditions` (порожній масив знімає фільтр поля). */
export const replaceFieldConditions = (where: Where | undefined, field: string, conditions: Where[]): Where => {
  const groups = groupsOf(where).map((group) => [...group.filter((condition) => !touches(condition, field)), ...conditions])
  if (groups.every((group) => group.length === 0)) return {}

  return { or: groups.map((and) => ({ and })) }
}

export const statusConditions = (status: OrderStatus | null): Where[] =>
  status ? [{ [STATUS_FIELD]: { equals: status } }] : []

export const dateConditions = (range: DateRange | null): Where[] =>
  range
    ? [
        { [DATE_FIELD]: { greater_than_equal: range.from } },
        ...(range.to ? [{ [DATE_FIELD]: { less_than: range.to } }] : []),
      ]
    : []

/** Умови поля в першій групі фільтра: за ними підсвічується активна кнопка. */
const conditionsOf = (where: Where | undefined, field: string): Array<Record<string, unknown>> =>
  groupsOf(where)[0]
    .filter((condition) => touches(condition, field))
    .map((condition) => (condition[field] ?? {}) as Record<string, unknown>)

/** Чи фільтрує список поле `field` хоч якоюсь умовою (кнопка «Усі» тоді не активна). */
export const hasFieldConditions = (where: Where | undefined, field: string): boolean =>
  groupsOf(where).some((group) => group.some((condition) => touches(condition, field)))

export const activeStatus = (where: Where | undefined): OrderStatus | null => {
  const conditions = conditionsOf(where, STATUS_FIELD)
  if (conditions.length !== 1) return null
  const value = conditions[0].equals

  return ORDER_STATUSES.includes(value as OrderStatus) ? (value as OrderStatus) : null
}

export const activeDatePreset = (where: Where | undefined, ranges: Record<DatePreset, DateRange>): DatePreset | null => {
  const conditions = conditionsOf(where, DATE_FIELD)
  const from = conditions.find((condition) => 'greater_than_equal' in condition)?.greater_than_equal
  const to = conditions.find((condition) => 'less_than' in condition)?.less_than
  if (from === undefined || conditions.length !== (to === undefined ? 1 : 2)) return null

  return DATE_PRESETS.find((preset) => ranges[preset].from === from && ranges[preset].to === to) ?? null
}

/** `YYYY-MM-DD` + `days` днів. */
export const shiftDay = (day: string, days: number): string => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/** Межі пресетів від календарного дня `today`; `startOfDay` дає початок дня в поясі обліку. */
export const datePresetRanges = (today: string, startOfDay: (day: string) => Date): Record<DatePreset, DateRange> => {
  const start = (day: string) => startOfDay(day).toISOString()

  return {
    today: { from: start(today) },
    yesterday: { from: start(shiftDay(today, -1)), to: start(today) },
    last7: { from: start(shiftDay(today, -6)) },
    last30: { from: start(shiftDay(today, -29)) },
    thisMonth: { from: start(`${today.slice(0, 8)}01`) },
  }
}
