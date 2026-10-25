import type { PayloadRequest } from 'payload'

import { StockTransactionRequiredError } from './errors'

/** Тип сесії беремо з адаптера Payload: `mongodb` не є прямою залежністю проєкту. */
export type ClientSession = NonNullable<PayloadRequest['payload']['db']['sessions']>[string]

/**
 * Сесія MongoDB тієї транзакції, яку відкрив `req` (Payload `initTransaction` або операція
 * Local API з цим `req`). Сирі операції з кешем ідуть у ній, тож відкат прибирає їх разом
 * із журналом. Без відкритої транзакції сервіс не працює.
 */
export const requireSession = async (req: PayloadRequest): Promise<ClientSession> => {
  const transactionID = await req.transactionID
  const session = transactionID === undefined ? undefined : req.payload.db.sessions?.[transactionID]

  if (!session || !session.inTransaction()) throw new StockTransactionRequiredError()

  return session
}
