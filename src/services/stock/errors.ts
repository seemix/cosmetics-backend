import { APIError } from 'payload'

export type StockShortage = {
  product: string
  warehouse: string
  requested: number
  available: number
}

/** Залишку на складі не вистачає. Уся транзакція має відкотитись. */
export class InsufficientStockError extends APIError<{ code: 'INSUFFICIENT_STOCK'; items: StockShortage[] }> {
  readonly items: StockShortage[]

  constructor(items: StockShortage[]) {
    super('Insufficient stock', 409, { code: 'INSUFFICIENT_STOCK', items }, true)
    this.name = 'InsufficientStockError'
    this.items = items
  }
}

/** Кеш змінився між читанням і записом (оптимістична умова). Транзакцію треба повторити. */
export class ConcurrentUpdateError extends APIError {
  constructor(message = 'Stock was changed by a concurrent operation, retry') {
    super(message, 409, undefined, true)
    this.name = 'ConcurrentUpdateError'
  }
}

/** Сервіс викликано без відкритої транзакції `req`. */
export class StockTransactionRequiredError extends APIError {
  constructor() {
    super('Stock operations require an open transaction on req', 500)
    this.name = 'StockTransactionRequiredError'
  }
}

/** Після списання за заданою вартістю вартість залишку стала б від'ємною при qty > 0. */
export class NegativeStockValueError extends APIError<{ product: string }> {
  constructor(product: string) {
    super(
      'Stock value would become negative, an inventory correction is required',
      409,
      { product },
      true,
    )
    this.name = 'NegativeStockValueError'
  }
}

/** Рух журналу вже сторновано. */
export class AlreadyRevertedError extends APIError<{ moves: string[] }> {
  constructor(moves: string[]) {
    super('Stock moves are already reverted', 409, { moves }, true)
    this.name = 'AlreadyRevertedError'
  }
}

const WRITE_CONFLICT = 112
const DUPLICATE_KEY = 11000

/**
 * Помилка, після якої транзакцію можна безпечно повторити: власний конфлікт кешу,
 * `TransientTransactionError` / `WriteConflict` MongoDB або дубль ключа при паралельному upsert.
 */
export const isTransientTransactionError = (error: unknown): boolean => {
  if (error instanceof ConcurrentUpdateError) return true
  if (!error || typeof error !== 'object') return false

  const mongoError = error as {
    code?: number
    codeName?: string
    errorLabels?: string[]
    hasErrorLabel?: (label: string) => boolean
  }

  return (
    mongoError.hasErrorLabel?.('TransientTransactionError') === true ||
    mongoError.errorLabels?.includes('TransientTransactionError') === true ||
    mongoError.code === WRITE_CONFLICT ||
    mongoError.codeName === 'WriteConflict' ||
    mongoError.code === DUPLICATE_KEY
  )
}
