import { APIError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import { customT } from '@/i18n'
import { isOrderAwaitingPosting, isOrderReserving, relationID } from '@/services/orders/orderState'
import { InsufficientStockError, type StockShortage } from '@/services/stock/errors'
import {
  assertAvailable,
  issueWithoutMoves,
  release,
  reserve,
  type PendingStockMove,
} from '@/services/stock/stockLedger.service'

/** Ключ `req.context`, у якому `postOrderStock` передає рухи `writeOrderStockMoves`. */
export const ORDER_STOCK_MOVES_CONTEXT_KEY = 'orderStockMoves'

type ItemLike = { product?: unknown; quantity?: unknown }
type ReservedLine = { product: string; warehouse: string; qty: number }
type Accounting = Record<string, unknown>

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

/** Нестача складу стає помилкою 409 з переліком нестач мовою адмінки. */
const withShortageMessage = async <T>(req: PayloadRequest, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof InsufficientStockError) error.message = await shortageMessage(req, error.items)
    throw error
  }
}

/** Рядки позицій на складі замовлення; однакові товари сумуються, порядок стабільний. */
const linesOf = (items: unknown, warehouse: string | null): ReservedLine[] => {
  if (!warehouse || !Array.isArray(items)) return []
  const totals = new Map<string, ReservedLine>()

  for (const item of items as ItemLike[]) {
    const product = relationID(item?.product) ?? ''
    const line = totals.get(product) ?? { product, warehouse, qty: 0 }
    line.qty += Number(item?.quantity)
    totals.set(product, line)
  }

  return [...totals.values()].sort((a, b) => a.product.localeCompare(b.product))
}

/** Знімок резерву з документа (`accounting.reservedItems`): зв'язки стають id. */
const snapshotOf = (order: { accounting?: { reservedItems?: unknown } | null } | undefined): ReservedLine[] => {
  const rows = order?.accounting?.reservedItems
  if (!Array.isArray(rows)) return []

  return rows.map((row: { product?: unknown; warehouse?: unknown; qty?: unknown }) => ({
    product: relationID(row.product) ?? '',
    warehouse: relationID(row.warehouse) ?? '',
    qty: Number(row.qty),
  }))
}

const sameLines = (a: ReservedLine[], b: ReservedLine[]) =>
  a.length === b.length &&
  a.every((line, i) => line.product === b[i].product && line.warehouse === b[i].warehouse && line.qty === b[i].qty)

/** Нестачі без резерву: перевірка доступного (qty − reserved), повний список рядків з нестачею. */
const findShortages = async (req: PayloadRequest, lines: ReservedLine[]): Promise<StockShortage[]> => {
  try {
    await assertAvailable(req, lines)
    return []
  } catch (error) {
    if (error instanceof InsufficientStockError) return error.items
    throw error
  }
}

const setReservation = (accounting: Accounting, lines: ReservedLine[], reservedAt: string | null) => {
  accounting.reservedItems = lines
  accounting.reservedAt = lines.length > 0 ? reservedAt : null
  accounting.shortages = []
}

const setBackorder = (accounting: Accounting, shortages: StockShortage[]) => {
  accounting.reservedItems = []
  accounting.reservedAt = null
  accounting.shortages = shortages
}

/**
 * Резерв і проведення замовлення (В20, В23; дизайн, розд. 4.2, 9.2), у транзакції запиту.
 * Create ставить `accounting.stockTracked` = чи ввімкнено облік складу: лише таке замовлення
 * резервує й проводиться. Знімок резерву `accounting.reservedItems` пише лише цей хук.
 *
 * - `pending`/`paid` облікового замовлення тримають резерв позицій на складі замовлення.
 *   При створенні нестача: сайт отримує 409, замовлення з адмінки стає `backorder` з `shortages`.
 *   Зміна позицій чи складу переносить резерв; нестача відхиляє збереження (409).
 * - `backorder` резерву не має, `shortages` рахуються перевіркою доступного.
 *   `backorder → pending/paid` резервує всі позиції або відхиляється; `→ shipped` заборонено.
 * - Відвантаження знімає знімок резерву й умовно списує доступне, ставить `stockPostedAt` і `cogsBani`,
 *   рухи з собівартістю кладе в `req.context` (на create id ще немає), журнал пише `writeOrderStockMoves`.
 * - Знімок знімається й при вимкненому обліку: резерв керується знімком, а не налаштуванням.
 * - Скасування не змінює резерв тут.
 *
 * Має йти після `populatePricesAndTotal` і `assignAccountingFields`: позиції й склад беруться готові.
 */
export const postOrderStock: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (!data || (operation !== 'create' && operation !== 'update')) return data

  // Проведення, резерв і ознаку обліку ставить лише цей хук; значення з тіла запиту ігноруються.
  delete req.context[ORDER_STOCK_MOVES_CONTEXT_KEY]
  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })

  if (operation === 'create') {
    data.accounting = {
      ...data.accounting,
      stockTracked: Boolean(settings.stockControlEnabled),
      stockPostedAt: null,
      cogsBani: null,
    }
  } else {
    const previous = originalDoc?.accounting ?? {}
    data.accounting = {
      ...previous,
      ...data.accounting,
      stockTracked: previous.stockTracked ?? null,
      stockPostedAt: previous.stockPostedAt ?? null,
      cogsBani: previous.cogsBani ?? null,
    }
  }
  const accounting = data.accounting as Accounting

  const previousStatus = operation === 'update' ? originalDoc?.status : undefined
  const status = data.status ?? previousStatus
  // Скасоване й уже відвантажене замовлення резерв тут не змінює.
  if (status === 'cancelled' || (status === 'shipped' && previousStatus === 'shipped')) return data

  if (status === 'shipped' && previousStatus === 'backorder') {
    throw new APIError(customT(req.t)('custom:error:backorderNotShippable'), 409, undefined, true)
  }

  const tracked = Boolean(settings.stockControlEnabled) && isOrderAwaitingPosting(data)
  const snapshot = operation === 'update' ? snapshotOf(originalDoc) : []
  if (!tracked && snapshot.length === 0) return data

  const warehouse = relationID(data.warehouse ?? originalDoc?.warehouse)
  if (tracked && !warehouse) {
    throw new APIError(customT(req.t)('custom:error:orderWarehouseRequired'), 400, undefined, true)
  }
  const lines = linesOf(data.items ?? originalDoc?.items, warehouse)
  const now = new Date()

  if (status === 'shipped') {
    if (snapshot.length > 0) await release(req, snapshot)
    setReservation(accounting, [], null)
    if (!tracked) return data

    const moves: PendingStockMove[] = await withShortageMessage(req, () =>
      issueWithoutMoves(req, { date: now, moveType: 'sale', lines }),
    )
    accounting.stockPostedAt = now.toISOString()
    accounting.cogsBani = -moves.reduce((sum, move) => sum + move.valueDeltaBani, 0) || 0
    req.context[ORDER_STOCK_MOVES_CONTEXT_KEY] = moves
    return data
  }

  if (operation === 'create') {
    if (status === 'backorder') {
      setBackorder(accounting, await findShortages(req, lines))
      return data
    }
    if (!isOrderReserving({ ...data, status })) return data

    try {
      await reserve(req, lines)
      setReservation(accounting, lines, now.toISOString())
    } catch (error) {
      if (!(error instanceof InsufficientStockError) || data.source === 'web') {
        if (error instanceof InsufficientStockError) error.message = await shortageMessage(req, error.items)
        throw error
      }
      // Транзакція триває: рядки, які встигли зарезервуватись, знімаються, backorder резерву не тримає.
      const short = new Set(error.items.map((item) => `${item.product}:${item.warehouse}`))
      const reserved = lines.filter((line) => !short.has(`${line.product}:${line.warehouse}`))
      if (reserved.length > 0) await release(req, reserved)
      data.status = 'backorder'
      setBackorder(accounting, error.items)
    }
    return data
  }

  const previousLines = linesOf(originalDoc?.items, relationID(originalDoc?.warehouse))
  const linesChanged = !sameLines(lines, previousLines)

  if (isOrderReserving({ ...data, status })) {
    const fromBackorder = previousStatus === 'backorder'
    if (!fromBackorder && !linesChanged) return data

    if (snapshot.length > 0) await release(req, snapshot)
    if (!tracked) {
      setReservation(accounting, [], null)
      return data
    }

    await withShortageMessage(req, () => reserve(req, lines))
    const previousReservedAt = originalDoc?.accounting?.reservedAt
    const reservedAt = !fromBackorder && previousReservedAt ? new Date(previousReservedAt).toISOString() : now.toISOString()
    setReservation(accounting, lines, reservedAt)
    return data
  }

  if (status === 'backorder') {
    if (previousStatus === 'backorder' && !linesChanged) return data
    if (snapshot.length > 0) await release(req, snapshot)
    setBackorder(accounting, tracked ? await findShortages(req, lines) : [])
    return data
  }

  // Замовлення, що не резервує (не облікове), знімку тримати не повинно.
  if (snapshot.length > 0) await release(req, snapshot)
  setReservation(accounting, [], null)
  return data
}
