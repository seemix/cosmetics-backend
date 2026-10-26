import type { CustomTranslationsKeys } from '@/i18n'

/** Мова інтерфейсу адмінки → локаль `Intl` для чисел і дат (суми йдуть через `formatMDL`). */
const LOCALES: Record<string, string> = { en: 'en-US', ru: 'ru-RU', ro: 'ro-MD' }

export const localeFor = (language: string): string => LOCALES[language] ?? LOCALES.en

export const formatInt = (value: number, language: string): string =>
  new Intl.NumberFormat(localeFor(language)).format(value)

/** ISO-момент → дата у поясі звітів. */
export const formatDate = (iso: string | null | undefined, language: string, timeZone: string): string => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeZone }).format(date)
}

export type DebtKind = 'owedToUs' | 'weOwe'

/**
 * Як читати знак боргу. `weOweBani` > 0: ми винні; < 0: аванс постачальнику (винні нам).
 * `owedToUsBani` > 0: покупець винен нам; < 0: переплата (винні ми).
 */
export const debtMeaning = (kind: DebtKind, bani: number): CustomTranslationsKeys => {
  if (bani === 0) return 'custom:reports:meaningSettled'
  if (kind === 'weOwe') return bani > 0 ? 'custom:reports:meaningWeOwe' : 'custom:reports:meaningWeOweNegative'

  return bani > 0 ? 'custom:reports:meaningOwedToUs' : 'custom:reports:meaningOwedToUsNegative'
}
