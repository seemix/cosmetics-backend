import { describe, expect, it } from 'vitest'

import { canRetry, errorKey, fieldErrorKeys } from '@/components/ReportsView/lib/errors'
import { debtMeaning, formatDate, localeFor } from '@/components/ReportsView/lib/format'
import {
  addDays,
  daysInclusive,
  MAX_PERIOD_DAYS,
  presetRange,
  validatePeriod,
} from '@/components/ReportsView/lib/periods'
import { buildReportUrl, defaultState, parseState, serializeState, validateState } from '@/components/ReportsView/lib/urlState'
import { formatMDL } from '@/utilities/money'

const CHISINAU = 'Europe/Chisinau'
const ID = '64b7f0c2a1b2c3d4e5f60718'

describe('пресети періодів у поясі звітів', () => {
  it('межі місяця: опівночі за місцевим часом уже новий місяць', () => {
    // 22:30 UTC 28 лютого = 00:30 1 березня в Кишиневі (UTC+2).
    const now = new Date('2026-02-28T22:30:00Z')

    expect(presetRange('thisMonth', now, CHISINAU)).toEqual({ from: '2026-03-01', to: '2026-03-01' })
    expect(presetRange('lastMonth', now, CHISINAU)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('перехід на літній час (29.03.2026, 03:00 → +3)', () => {
    // До переходу: 21:30 UTC = 23:30 28 березня (UTC+2).
    expect(presetRange('thisMonth', new Date('2026-03-28T21:30:00Z'), CHISINAU).to).toBe('2026-03-28')
    // Після переходу: 21:30 UTC = 00:30 30 березня (UTC+3), хоча в UTC ще 29-те.
    expect(presetRange('thisMonth', new Date('2026-03-29T21:30:00Z'), CHISINAU).to).toBe('2026-03-30')
  })

  it('перехід на зимовий час (25.10.2026, 04:00 → +2)', () => {
    // 21:30 UTC 24 жовтня = 00:30 25 жовтня (UTC+3).
    expect(presetRange('thisMonth', new Date('2026-10-24T21:30:00Z'), CHISINAU).to).toBe('2026-10-25')
    // 21:30 UTC 25 жовтня = 23:30 25 жовтня (UTC+2); у UTC+3 це був би вже 26-й.
    expect(presetRange('thisMonth', new Date('2026-10-25T21:30:00Z'), CHISINAU).to).toBe('2026-10-25')
  })

  it('межа року: січень дає минулий місяць у попередньому році', () => {
    const now = new Date('2026-12-31T22:30:00Z') // 00:30 1 січня 2027
    expect(presetRange('yearToDate', now, CHISINAU)).toEqual({ from: '2027-01-01', to: '2027-01-01' })
    expect(presetRange('lastMonth', now, CHISINAU)).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(presetRange('thisQuarter', now, CHISINAU)).toEqual({ from: '2027-01-01', to: '2027-01-01' })
  })

  it('квартал починається з першого місяця кварталу', () => {
    expect(presetRange('thisQuarter', new Date('2026-05-15T12:00:00Z'), CHISINAU)).toEqual({ from: '2026-04-01', to: '2026-05-15' })
    expect(presetRange('thisQuarter', new Date('2026-10-26T12:00:00Z'), CHISINAU)).toEqual({ from: '2026-10-01', to: '2026-10-26' })
  })

  it('пояс UTC: кінець місяця', () => {
    expect(presetRange('thisMonth', new Date('2026-03-31T23:59:59Z'), 'UTC')).toEqual({ from: '2026-03-01', to: '2026-03-31' })
  })

  it('лютий високосного року', () => {
    expect(presetRange('lastMonth', new Date('2028-03-10T12:00:00Z'), 'UTC')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('валідація періоду на клієнті', () => {
  it('приймає коректний період і межу в 400 днів', () => {
    expect(validatePeriod('2026-01-01', '2026-01-01')).toBeNull()
    expect(validatePeriod('2026-01-01', addDays('2026-01-01', MAX_PERIOD_DAYS - 1))).toBeNull()
  })

  it('відхиляє from > to', () => {
    expect(validatePeriod('2026-02-02', '2026-02-01')).toBe('order')
  })

  it('відхиляє понад 400 днів', () => {
    const to = addDays('2026-01-01', MAX_PERIOD_DAYS)
    expect(daysInclusive('2026-01-01', to)).toBe(MAX_PERIOD_DAYS + 1)
    expect(validatePeriod('2026-01-01', to)).toBe('tooLong')
  })

  it('відхиляє порожні й неіснуючі дати', () => {
    expect(validatePeriod('', '2026-01-01')).toBe('required')
    expect(validatePeriod('2026-02-30', '2026-03-01')).toBe('format')
  })

  it('вкладки без періоду не валідуються', () => {
    const state = { ...defaultState(new Date('2026-05-15T12:00:00Z'), 'UTC'), tab: 'stock' as const, from: '2026-05-10', to: '2026-05-01' }
    expect(validateState(state)).toBeNull()
    expect(validateState({ ...state, tab: 'profit' })).toBe('order')
  })
})

describe('стан у URL', () => {
  const now = new Date('2026-05-15T12:00:00Z')
  const parse = (query: string) => parseState(new URLSearchParams(query), now, 'UTC')

  it('порожній URL дає типовий стан: прибуток за поточний місяць', () => {
    expect(parse('')).toEqual({
      tab: 'profit',
      from: '2026-05-01',
      to: '2026-05-15',
      asOf: '',
      warehouse: '',
      q: '',
      supplier: '',
      category: '',
      account: '',
      manager: '',
      page: 1,
    })
  })

  it('невалідні значення замінюються типовими', () => {
    const state = parse(`tab=nope&from=2026-02-30&to=abc&asOf=x&warehouse=123&supplier=${ID};drop&page=0&q=${'a'.repeat(101)}`)

    expect(state).toEqual(parse(''))
    expect(parse('page=-3').page).toBe(1)
    expect(parse('page=abc').page).toBe(1)
  })

  it('коректні значення зберігаються', () => {
    const state = parse(`tab=expenses&from=2026-01-01&to=2026-01-31&category=${ID}&account=${ID}&page=3&q=cream`)

    expect(state).toMatchObject({ tab: 'expenses', from: '2026-01-01', to: '2026-01-31', category: ID, account: ID, page: 3, q: 'cream' })
  })

  it('serializeState → parseState повертає той самий стан', () => {
    const state = parse(`tab=purchases&from=2026-01-01&to=2026-02-01&supplier=${ID}&page=2`)

    expect(parse(serializeState(state))).toEqual(state)
    expect(serializeState(parse(''))).toBe('tab=profit&from=2026-05-01&to=2026-05-15')
  })

  it('запит до R1 містить лише параметри вкладки', () => {
    const state = parse(`tab=purchases&from=2026-01-01&to=2026-02-01&supplier=${ID}&warehouse=${ID}&page=2`)

    expect(buildReportUrl(state, '/api')).toBe(`/api/reports/purchases?from=2026-01-01&to=2026-02-01&supplier=${ID}&page=2`)
    expect(buildReportUrl({ ...state, tab: 'profit' }, '/api')).toBe('/api/reports/profit?from=2026-01-01&to=2026-02-01')
    expect(buildReportUrl({ ...state, tab: 'stock', q: 'крем' }, '/api')).toBe(
      `/api/reports/stock?warehouse=${ID}&q=%D0%BA%D1%80%D0%B5%D0%BC&page=2`,
    )
    expect(buildReportUrl({ ...state, tab: 'debts', asOf: '2026-03-01', page: 1 }, '/custom-api')).toBe(
      '/custom-api/reports/debts?asOf=2026-03-01',
    )
    expect(buildReportUrl({ ...state, tab: 'salary', manager: ID }, '/api')).toBe(
      `/api/reports/salary?from=2026-01-01&to=2026-02-01&manager=${ID}`,
    )
    expect(buildReportUrl({ ...state, tab: 'expenses', category: ID, account: '' }, '/api')).toBe(
      `/api/reports/expenses?from=2026-01-01&to=2026-02-01&category=${ID}&page=2`,
    )
  })
})

describe('суми, знаки боргів і дати', () => {
  it('суми з двома знаками, мінус зберігається', () => {
    expect(formatMDL(247720)).toBe('2,477.20')
    expect(formatMDL(0)).toBe('0.00')
    expect(formatMDL(-5)).toBe('-0.05')
    expect(formatMDL(-1234500)).toBe('-12,345.00')
  })

  it('weOweBani: плюс — ми винні, мінус — аванс', () => {
    expect(debtMeaning('weOwe', 100)).toBe('custom:reports:meaningWeOwe')
    expect(debtMeaning('weOwe', -100)).toBe('custom:reports:meaningWeOweNegative')
    expect(debtMeaning('weOwe', 0)).toBe('custom:reports:meaningSettled')
  })

  it('owedToUsBani: плюс — винні нам, мінус — переплата', () => {
    expect(debtMeaning('owedToUs', 100)).toBe('custom:reports:meaningOwedToUs')
    expect(debtMeaning('owedToUs', -100)).toBe('custom:reports:meaningOwedToUsNegative')
    expect(debtMeaning('owedToUs', 0)).toBe('custom:reports:meaningSettled')
  })

  it('локалі за мовою адмінки', () => {
    expect(localeFor('en')).toBe('en-US')
    expect(localeFor('ru')).toBe('ru-RU')
    expect(localeFor('ro')).toBe('ro-MD')
    expect(localeFor('xx')).toBe('en-US')
  })

  it('дата береться в поясі звітів', () => {
    // 22:30 UTC = 00:30 наступного дня в Кишиневі.
    expect(formatDate('2026-02-28T22:30:00Z', 'en', CHISINAU)).toBe(formatDate('2026-03-01T12:00:00Z', 'en', CHISINAU))
    expect(formatDate(null, 'en', CHISINAU)).toBe('—')
    expect(formatDate('not a date', 'en', CHISINAU)).toBe('—')
  })
})

describe('коди помилок відповіді → ключі повідомлень', () => {
  it('401 і 403 — немає доступу', () => {
    expect(errorKey({ status: 401, code: 'UNAUTHORIZED' })).toBe('custom:reports:errorNoAccess')
    expect(errorKey({ status: 403, code: 'FORBIDDEN' })).toBe('custom:reports:errorNoAccess')
  })

  it('400 розрізняє параметри й задовгий період', () => {
    expect(errorKey({ status: 400, code: 'INVALID_PARAMS' })).toBe('custom:reports:errorInvalidParams')
    expect(errorKey({ status: 400, code: 'PERIOD_TOO_LONG' })).toBe('custom:reports:errorPeriodTooLong')
  })

  it('решта — загальна помилка з повтором', () => {
    for (const error of [{ status: 500 }, { status: 0 }, { status: 404 }, { status: 400, code: 'OTHER' }]) {
      expect(errorKey(error)).toBe('custom:reports:errorLoadFailed')
      expect(canRetry(error)).toBe(true)
    }
    expect(canRetry({ status: 403 })).toBe(false)
    expect(canRetry({ status: 400, code: 'INVALID_PARAMS' })).toBe(false)
  })

  it('поля й причини INVALID_PARAMS мають ключі', () => {
    expect(fieldErrorKeys({ field: 'from', reason: 'required' })).toEqual({
      field: 'custom:reports:filterFrom',
      reason: 'custom:reports:reasonRequired',
    })
    expect(fieldErrorKeys({ field: 'unknown', reason: 'weird' })).toEqual({ field: null, reason: null })
  })
})
