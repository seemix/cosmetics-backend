import { APIError } from 'payload'

export type CashShortage = {
  account: string
  requested: number
  available: number
}

/** У касі з `allowNegative = false` не вистачає коштів. Уся транзакція має відкотитись. */
export class InsufficientCashError extends APIError<{ code: 'INSUFFICIENT_CASH' } & CashShortage> {
  readonly shortage: CashShortage

  /** `message` формується викликачем мовою адмінки (`req.t`). */
  constructor(message: string, shortage: CashShortage) {
    super(message, 409, { code: 'INSUFFICIENT_CASH', ...shortage }, true)
    this.name = 'InsufficientCashError'
    this.shortage = shortage
  }
}
