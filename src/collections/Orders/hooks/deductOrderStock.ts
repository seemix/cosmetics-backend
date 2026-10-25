import { APIError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import { customT } from '@/i18n'
import { InsufficientStockError, type StockShortage } from '@/services/stock/errors'
import { issueWithoutMoves, type PendingStockMove } from '@/services/stock/stockLedger.service'

/** Ключ `req.context`, у якому `deductOrderStock` передає рухи `writeOrderStockMoves`. */
export const ORDER_STOCK_MOVES_CONTEXT_KEY = 'orderStockMoves'

type ItemLike = { product?: unknown; quantity?: unknown }

const relationID = (value: unknown): string | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return String(value)
}

/** Текст нестачі мовою адмінки з назвами товарів і складу замість id. */
const shortageMessage = async (req: PayloadRequest, items: StockShortage[]): Promise<string> => {
  const products = await req.payload.find({
    collection: 'products',
    where: { id: { in: items.map((item) => item.product) } },
    select: { title: true },
    pagination: false,
    depth: 0,
    req,
  })
  const titles = new Map(products.docs.map((product) => [String(product.id), product.title]))
  const warehouse = await req.payload.findByID({
    collection: 'warehouses',
    id: items[0].warehouse,
    select: { name: true },
    depth: 0,
    disableErrors: true,
    req,
  })

  return items
    .map((item) =>
      customT(req.t)('custom:error:insufficientStock', {
        product: titles.get(item.product) ?? item.product,
        warehouse: warehouse?.name ?? item.warehouse,
        requested: String(item.requested),
        available: String(item.available),
      }),
    )
    .join('; ')
}

/**
 * Списання залишку при створенні замовлення (дизайн, розд. 4.2, 9.2), у транзакції створення.
 * Облік вимкнено ⇒ нічого не списує, `accounting.stockPostedAt` порожнє.
 * Інакше умовно списує зі складу замовлення через сервіс руху запасів, ставить `stockPostedAt`
 * і `cogsBani`, а рухи з собівартістю по позиціях кладе в `req.context`: id замовлення ще немає,
 * журнал пише `writeOrderStockMoves`. Нестача кидає `InsufficientStockError` і відкочує замовлення.
 * Має йти після `assignAccountingFields`, бо склад визначає він.
 */
export const deductOrderStock: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create' || !data) return data

  // Проведення ставить лише цей хук; значення з тіла запиту ігноруються.
  delete req.context[ORDER_STOCK_MOVES_CONTEXT_KEY]
  data.accounting = { ...data.accounting, stockPostedAt: null, cogsBani: null }

  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  if (!settings.stockControlEnabled) return data

  const warehouse = relationID(data.warehouse)
  if (!warehouse) {
    throw new APIError(customT(req.t)('custom:error:orderWarehouseRequired'), 400, undefined, true)
  }

  const items: ItemLike[] = Array.isArray(data.items) ? data.items : []
  const lines = items.map((item) => ({
    product: relationID(item.product) ?? '',
    warehouse,
    qty: Number(item.quantity),
  }))
  const date = new Date()

  let moves: PendingStockMove[]
  try {
    moves = await issueWithoutMoves(req, { date, moveType: 'sale', lines })
  } catch (error) {
    if (error instanceof InsufficientStockError) error.message = await shortageMessage(req, error.items)
    throw error
  }

  data.accounting.stockPostedAt = date.toISOString()
  data.accounting.cogsBani = -moves.reduce((sum, move) => sum + move.valueDeltaBani, 0) || 0
  req.context[ORDER_STOCK_MOVES_CONTEXT_KEY] = moves

  return data
}
