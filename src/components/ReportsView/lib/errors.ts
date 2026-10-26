import type { CustomTranslationsKeys } from '@/i18n'

export type ParamErrorInfo = { field: string; reason: string }

export type ReportError = { status: number; code?: string; fields?: ParamErrorInfo[] }

/** Код відповіді R1 → ключ повідомлення. 401/403 «немає доступу», 400 про параметри, решта загальна. */
export const errorKey = ({ status, code }: ReportError): CustomTranslationsKeys => {
  if (status === 401 || status === 403) return 'custom:reports:errorNoAccess'
  if (status === 400 && code === 'PERIOD_TOO_LONG') return 'custom:reports:errorPeriodTooLong'
  if (status === 400 && code === 'INVALID_PARAMS') return 'custom:reports:errorInvalidParams'

  return 'custom:reports:errorLoadFailed'
}

/** Повторити має сенс лише для загальної помилки. */
export const canRetry = (error: ReportError): boolean => errorKey(error) === 'custom:reports:errorLoadFailed'

const FIELDS: Record<string, CustomTranslationsKeys> = {
  from: 'custom:reports:filterFrom',
  to: 'custom:reports:filterTo',
  asOf: 'custom:reports:filterAsOf',
  warehouse: 'custom:term:warehouse',
  supplier: 'custom:term:supplier',
  category: 'custom:reports:filterCategory',
  account: 'custom:term:cashAccount',
  manager: 'custom:term:manager',
  q: 'custom:reports:filterSearch',
  page: 'custom:reports:page',
}

const REASONS: Record<string, CustomTranslationsKeys> = {
  required: 'custom:reports:reasonRequired',
  format: 'custom:reports:reasonFormat',
  range: 'custom:reports:reasonRange',
  order: 'custom:reports:reasonOrder',
  not_found: 'custom:reports:reasonNotFound',
}

/** Ключі підпису поля й причини; `null`, якщо невідомі (тоді показується сирий рядок). */
export const fieldErrorKeys = ({ field, reason }: ParamErrorInfo) => ({
  field: FIELDS[field] ?? null,
  reason: REASONS[reason] ?? null,
})
