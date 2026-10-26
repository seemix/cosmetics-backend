import type { PayloadRequest } from 'payload'

import { endOfDay, periodBounds } from '@/utilities/period'

import { model, type Paging, type Period, readSession, toObjectId } from './common'

/**
 * Параметри звітів: лише описані в задачі R1, усе інше ігнорується. Рядки користувача не потрапляють
 * у `$where` чи регулярки: id перевіряються як ObjectId, дати як `YYYY-MM-DD`.
 */

export const MAX_PERIOD_DAYS = 400
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
const MAX_QUERY_LENGTH = 100

export type ParamErrorReason = 'required' | 'format' | 'range' | 'order' | 'not_found'
export type ParamError = { field: string; reason: ParamErrorReason }

export class ReportParamsError extends Error {
  constructor(
    readonly code: 'INVALID_PARAMS' | 'PERIOD_TOO_LONG',
    readonly fields: ParamError[],
  ) {
    super(code)
    this.name = 'ReportParamsError'
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const OBJECT_ID = /^[0-9a-fA-F]{24}$/
const INTEGER = /^\d{1,9}$/

/** `YYYY-MM-DD` і справжня дата (без 2026-02-30). */
const isDay = (value: string) => {
  if (!DAY.test(value)) return false
  const [year, month, date] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, date))

  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date
}

const dayNumber = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000

/** Тип документа, на який посилається параметр-id, і додаткова умова (менеджер має роль manager). */
type Reference = { collection: string; filter?: Record<string, unknown> }

export const REFERENCES = {
  warehouse: { collection: 'warehouses' },
  supplier: { collection: 'suppliers' },
  category: { collection: 'expense-categories' },
  account: { collection: 'cash-accounts' },
  manager: { collection: 'users', filter: { roles: 'manager' } },
} satisfies Record<string, Reference>

/**
 * Збирає помилки всіх параметрів і кидає їх разом у `finish()`. Перевірка існування id іде після
 * перевірки формату, одним `findOne` на параметр.
 */
export class ReportParams {
  private readonly errors: ParamError[] = []
  private readonly references: Array<{ field: string; id: string; reference: Reference }> = []
  private tooLong = false

  constructor(private readonly req: PayloadRequest) {}

  private raw(name: string): string | undefined {
    const value = this.req.searchParams?.get(name)

    return value === null || value === undefined || value.trim() === '' ? undefined : value.trim()
  }

  private fail(field: string, reason: ParamErrorReason) {
    this.errors.push({ field, reason })
  }

  /** Обов'язкові `from`, `to`: from ≤ to, не більше 400 днів включно. */
  period(): Period | undefined {
    const from = this.raw('from')
    const to = this.raw('to')

    if (!from) this.fail('from', 'required')
    else if (!isDay(from)) this.fail('from', 'format')
    if (!to) this.fail('to', 'required')
    else if (!isDay(to)) this.fail('to', 'format')
    if (!from || !to || !isDay(from) || !isDay(to)) return undefined

    if (from > to) {
      this.fail('to', 'order')
      return undefined
    }
    if (dayNumber(to) - dayNumber(from) + 1 > MAX_PERIOD_DAYS) {
      this.tooLong = true
      return undefined
    }

    const { from: start, to: end } = periodBounds(from, to)

    return { from, to, start, end }
  }

  /** Необов'язкова дата `YYYY-MM-DD` → кінець цього дня в поясі обліку; без неї зараз. */
  asOf(name = 'asOf'): { day: string | null; at: Date } {
    const value = this.raw(name)
    if (value === undefined) return { day: null, at: new Date() }
    if (!isDay(value)) {
      this.fail(name, 'format')
      return { day: null, at: new Date() }
    }

    return { day: value, at: endOfDay(value) }
  }

  /** Необов'язковий id документа відомого типу. */
  reference(name: keyof typeof REFERENCES): string | undefined {
    const value = this.raw(name)
    if (value === undefined) return undefined
    if (!OBJECT_ID.test(value)) {
      this.fail(name, 'format')
      return undefined
    }

    this.references.push({ field: name, id: value, reference: REFERENCES[name] })
    return value
  }

  private integer(name: string, fallback: number, min: number, max: number): number {
    const value = this.raw(name)
    if (value === undefined) return fallback
    if (!INTEGER.test(value)) {
      this.fail(name, 'format')
      return fallback
    }

    const parsed = Number(value)
    if (parsed < min || parsed > max) {
      this.fail(name, 'range')
      return fallback
    }

    return parsed
  }

  paging(): Paging {
    return {
      page: this.integer('page', 1, 1, Number.MAX_SAFE_INTEGER),
      limit: this.integer('limit', DEFAULT_LIMIT, 1, MAX_LIMIT),
    }
  }

  bool(name: string, fallback: boolean): boolean {
    const value = this.raw(name)
    if (value === undefined) return fallback
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false

    this.fail(name, 'format')
    return fallback
  }

  /** Рядок пошуку; у запит іде лише екранованим (див. `escapeRegExp`). */
  text(name: string): string | undefined {
    const value = this.raw(name)
    if (value !== undefined && value.length > MAX_QUERY_LENGTH) {
      this.fail(name, 'range')
      return undefined
    }

    return value
  }

  /** Перевіряє існування id і кидає `ReportParamsError`, якщо є хоч одна помилка. */
  async finish(): Promise<void> {
    if (this.errors.length === 0 && this.tooLong) {
      throw new ReportParamsError('PERIOD_TOO_LONG', [{ field: 'to', reason: 'range' }])
    }

    if (this.errors.length === 0) {
      const session = await readSession(this.req)

      // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
      for (const { field, id, reference } of this.references) {
        const found = await model(this.req, reference.collection).collection.findOne(
          { _id: toObjectId(this.req, id), ...reference.filter },
          { session, projection: { _id: 1 } },
        )
        if (!found) this.fail(field, 'not_found')
      }
    }

    if (this.errors.length > 0) throw new ReportParamsError('INVALID_PARAMS', this.errors)
  }
}

/** Екранування для безпечного пошуку підрядка: рядок користувача стає літералом. */
export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
