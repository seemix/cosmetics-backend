import type { CollectionAfterChangeHook } from 'payload'

import { type PendingStockMove, writeMoves } from '@/services/stock/stockLedger.service'

import { ORDER_STOCK_MOVES_CONTEXT_KEY } from './deductOrderStock'

/**
 * Журнал продажу для проведеного замовлення (дизайн, розд. 9.2): рухи `sale`, які порахував
 * `deductOrderStock`, записуються з `docId = doc.id` у тій самій транзакції. Помилка тут
 * відкочує й замовлення. Має йти першим в `afterChange`, до сповіщень.
 */
export const writeOrderStockMoves: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc

  const moves = req.context[ORDER_STOCK_MOVES_CONTEXT_KEY] as PendingStockMove[] | undefined
  if (!moves) return doc
  delete req.context[ORDER_STOCK_MOVES_CONTEXT_KEY]

  await writeMoves(req, { collection: 'orders', id: String(doc.id), number: doc.orderNumber ?? undefined }, moves)

  return doc
}
