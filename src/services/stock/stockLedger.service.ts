import type { PayloadRequest } from 'payload'

import type { StockMove } from '@/payload-types'

import {
  AlreadyRevertedError,
  ConcurrentUpdateError,
  InsufficientStockError,
  NegativeStockValueError,
  type StockShortage,
} from './errors'
import { type ClientSession, requireSession } from './session'

/**
 * Єдине місце, що змінює залишки й середню собівартість (docs/accounting/design.md, розд. 4.2, 5.3).
 * Кожна функція вимагає відкриту транзакцію `req`: кеш (`stock-balances`, `product-costs`)
 * змінюється сирими операціями в її сесії, журнал `stock-moves` пишеться через Local API з `req`.
 * Будь-яка помилка має відкотити всю транзакцію; `ConcurrentUpdateError` означає «повторити».
 */

type MoveType = StockMove['moveType']

/** Документ, що спричинив рух. */
export type StockDocRef = {
  collection: string
  id: string
  number?: string
}

type BaseArgs = {
  doc: StockDocRef
  /** Дата руху, за замовчуванням зараз. */
  date?: Date
}

export type ReceiveLine = { product: string; warehouse: string; qty: number; valueBani: number }
export type IssueLine = {
  product: string
  warehouse: string
  qty: number
  /** Явна вартість списання (сторно приходу). Без неї списання йде за середньою. */
  valueBani?: number
}
export type TransferLine = { product: string; qty: number }

type ObjectId = ReturnType<typeof toObjectId>

type BalanceDoc = { _id: ObjectId; qty: number }
type CostDoc = { _id: ObjectId; qty: number; valueBani: number }

type Context = {
  req: PayloadRequest
  session: ClientSession
  date: Date
}

const TRANSFER_TYPES: MoveType[] = ['transfer_out', 'transfer_in']

const openContext = async (req: PayloadRequest, date?: Date): Promise<Context> => ({
  req,
  session: await requireSession(req),
  date: date ?? new Date(),
})

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) =>
  new req.payload.db.collections['stock-moves'].base.Types.ObjectId(id)

const balances = (req: PayloadRequest) => req.payload.db.collections['stock-balances'].collection
const costs = (req: PayloadRequest) => req.payload.db.collections['product-costs'].collection

const balanceKey = (ctx: Context, product: string, warehouse: string) => ({
  product: toObjectId(ctx.req, product),
  variant: null,
  warehouse: toObjectId(ctx.req, warehouse),
})

const assertPositiveInteger = (qty: number) => {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`Quantity must be a positive integer, got ${qty}`)
}

const assertBani = (value: number) => {
  if (!Number.isInteger(value)) throw new Error(`Value must be a whole number of bani, got ${value}`)
}

/** Стабільний порядок рядків, щоб паралельні транзакції брали документи в однаковій черговості. */
const byProductAndWarehouse = <T extends { product: string; warehouse: string }>(lines: T[]): T[] =>
  [...lines].sort((a, b) => a.product.localeCompare(b.product) || a.warehouse.localeCompare(b.warehouse))

// -0 після округлення від'ємних нулів не потрібне ні в кеші, ні в журналі.
const roundBani = (value: number) => Math.round(value) || 0

const increaseBalance = async (ctx: Context, product: string, warehouse: string, qty: number) => {
  await balances(ctx.req).updateOne(
    balanceKey(ctx, product, warehouse),
    { $inc: { qty }, $set: { updatedAt: ctx.date }, $setOnInsert: { createdAt: ctx.date } },
    { upsert: true, session: ctx.session },
  )
}

/**
 * Умовне списання з усіх рядків. Нестачі збираються по всіх рядках і кидаються однією помилкою,
 * щоб клієнт бачив повний список; частково списане відкотить транзакція.
 */
const decreaseBalances = async (ctx: Context, lines: Array<{ product: string; warehouse: string; qty: number }>) => {
  const shortages: StockShortage[] = []

  for (const { product, warehouse, qty } of lines) {
    const key = balanceKey(ctx, product, warehouse)
    const result = await balances(ctx.req).updateOne(
      { ...key, qty: { $gte: qty } },
      { $inc: { qty: -qty }, $set: { updatedAt: ctx.date } },
      { session: ctx.session },
    )

    if (result.modifiedCount === 0) {
      const current = await balances(ctx.req).findOne<BalanceDoc>(key, { session: ctx.session })
      shortages.push({ product, warehouse, requested: qty, available: current?.qty ?? 0 })
    }
  }

  if (shortages.length > 0) throw new InsufficientStockError(shortages)
}

/**
 * Зміна середньої собівартості товару з оптимістичною умовою на прочитані `qty` і `valueBani`.
 * `value = 'average'` для витрати означає `round(valueBani × q / qty)`.
 * Правила: `qty = 0 ⇒ valueBani = 0`; `valueBani < 0` при `qty > 0` заборонено.
 * Повертає фактичну зміну вартості й середню до руху.
 */
const changeCost = async (
  ctx: Context,
  product: string,
  qtyDelta: number,
  value: number | 'average',
  extra: Record<string, unknown> = {},
): Promise<{ valueDeltaBani: number; unitCostBani: number }> => {
  const filter = { product: toObjectId(ctx.req, product) }
  const current = await costs(ctx.req).findOne<CostDoc>(filter, { session: ctx.session })
  const qty = current?.qty ?? 0
  const valueBani = current?.valueBani ?? 0
  const newQty = qty + qtyDelta

  if (newQty < 0) {
    throw new Error(`product-costs for ${product} is out of sync with stock-balances (qty ${qty}, change ${qtyDelta})`)
  }

  let valueDeltaBani = value === 'average' ? -roundBani((valueBani * -qtyDelta) / qty) : value
  if (newQty === 0) valueDeltaBani = -valueBani
  else if (valueBani + valueDeltaBani < 0) throw new NegativeStockValueError(product)
  valueDeltaBani ||= 0

  const unitCostBani = qty > 0 ? valueBani / qty : qtyDelta > 0 ? valueDeltaBani / qtyDelta : 0

  if (!current) {
    // Першого документа ще немає: вставляємо, лише якщо паралельна транзакція не встигла.
    const result = await costs(ctx.req).updateOne(
      filter,
      {
        $setOnInsert: {
          ...filter,
          qty: newQty,
          valueBani: valueBani + valueDeltaBani,
          ...extra,
          createdAt: ctx.date,
          updatedAt: ctx.date,
        },
      },
      { upsert: true, session: ctx.session },
    )
    if (result.upsertedCount === 0) throw new ConcurrentUpdateError()
  } else {
    const result = await costs(ctx.req).updateOne(
      { _id: current._id, qty, valueBani },
      { $inc: { qty: qtyDelta, valueBani: valueDeltaBani }, $set: { ...extra, updatedAt: ctx.date } },
      { session: ctx.session },
    )
    if (result.modifiedCount === 0) throw new ConcurrentUpdateError()
  }

  return { valueDeltaBani, unitCostBani }
}

/** Середня до руху без зміни кешу (для переміщень). */
const readUnitCost = async (ctx: Context, product: string): Promise<number> => {
  const current = await costs(ctx.req).findOne<CostDoc>(
    { product: toObjectId(ctx.req, product) },
    { session: ctx.session },
  )

  return current?.qty ? current.valueBani / current.qty : 0
}

type MoveData = {
  product: string
  warehouse: string
  qtyDelta: number
  valueDeltaBani: number
  unitCostBani: number
  moveType: MoveType
  reversalOf?: string
}

/** Рух, уже проведений по кешу, але ще не записаний у журнал. */
export type PendingStockMove = MoveData & { date: Date }

const writeMove = (ctx: Context, doc: StockDocRef, move: MoveData): Promise<StockMove> =>
  ctx.req.payload.create({
    collection: 'stock-moves',
    data: {
      ...move,
      date: ctx.date.toISOString(),
      docCollection: doc.collection,
      docId: doc.id,
      docNumber: doc.number,
    },
    depth: 0,
    req: ctx.req,
  })

/** Прихід: залишок на складі й середня товару збільшуються на `qty` і `valueBani` рядка. */
export const receive = async (
  req: PayloadRequest,
  { doc, date, moveType, lines }: BaseArgs & { moveType: MoveType; lines: ReceiveLine[] },
): Promise<StockMove[]> => {
  const ctx = await openContext(req, date)
  const moves: StockMove[] = []

  for (const line of byProductAndWarehouse(lines)) {
    assertPositiveInteger(line.qty)
    assertBani(line.valueBani)
    if (line.valueBani < 0) throw new Error('Receipt value must not be negative')

    await increaseBalance(ctx, line.product, line.warehouse, line.qty)
    const extra = moveType === 'purchase' ? { lastPurchaseUnitCostBani: line.valueBani / line.qty } : {}
    const { valueDeltaBani, unitCostBani } = await changeCost(ctx, line.product, line.qty, line.valueBani, extra)

    moves.push(
      await writeMove(ctx, doc, {
        product: line.product,
        warehouse: line.warehouse,
        qtyDelta: line.qty,
        valueDeltaBani,
        unitCostBani,
        moveType,
      }),
    )
  }

  return moves
}

/**
 * Витрата: умовне списання залишку (нестача ⇒ `InsufficientStockError`), потім собівартість
 * за середньою `round(valueBani × q / qty)` або за явною `valueBani` рядка.
 */
export const issue = async (
  req: PayloadRequest,
  { doc, ...args }: BaseArgs & { moveType: MoveType; lines: IssueLine[] },
): Promise<StockMove[]> => writeMoves(req, doc, await issueWithoutMoves(req, args))

/**
 * Те саме, що `issue`, але без запису журналу: повертає обчислені рухи. Для документа, id якого
 * ще немає (замовлення в `beforeChange`); рухи записує `writeMoves` у тій самій транзакції.
 */
export const issueWithoutMoves = async (
  req: PayloadRequest,
  { date, moveType, lines }: Omit<BaseArgs, 'doc'> & { moveType: MoveType; lines: IssueLine[] },
): Promise<PendingStockMove[]> => {
  const ctx = await openContext(req, date)
  const sorted = byProductAndWarehouse(lines)

  for (const line of sorted) {
    assertPositiveInteger(line.qty)
    if (line.valueBani !== undefined) assertBani(line.valueBani)
  }

  await decreaseBalances(ctx, sorted)

  const moves: PendingStockMove[] = []
  for (const line of sorted) {
    const value = line.valueBani === undefined ? 'average' : -line.valueBani
    const { valueDeltaBani, unitCostBani } = await changeCost(ctx, line.product, -line.qty, value)

    moves.push({
      product: line.product,
      warehouse: line.warehouse,
      qtyDelta: -line.qty,
      valueDeltaBani,
      unitCostBani,
      moveType,
      date: ctx.date,
    })
  }

  return moves
}

/** Записує в журнал рухи, обчислені `issueWithoutMoves`, у транзакції `req`. */
export const writeMoves = async (
  req: PayloadRequest,
  doc: StockDocRef,
  moves: PendingStockMove[],
): Promise<StockMove[]> => {
  const session = await requireSession(req)
  const result: StockMove[] = []

  for (const { date, ...move } of moves) result.push(await writeMove({ req, session, date }, doc, move))

  return result
}

/** Переміщення: умовно зі складу `from`, на склад `to`. Середня й `product-costs` не змінюються. */
export const transfer = async (
  req: PayloadRequest,
  { doc, date, from, to, lines }: BaseArgs & { from: string; to: string; lines: TransferLine[] },
): Promise<StockMove[]> => {
  if (from === to) throw new Error('Source and destination warehouses must differ')

  const ctx = await openContext(req, date)
  const outgoing = byProductAndWarehouse(lines.map((line) => ({ ...line, warehouse: from })))

  outgoing.forEach((line) => assertPositiveInteger(line.qty))
  await decreaseBalances(ctx, outgoing)

  const moves: StockMove[] = []
  for (const line of outgoing) {
    await increaseBalance(ctx, line.product, to, line.qty)
    const unitCostBani = await readUnitCost(ctx, line.product)
    const move = { product: line.product, valueDeltaBani: 0, unitCostBani }

    moves.push(await writeMove(ctx, doc, { ...move, warehouse: from, qtyDelta: -line.qty, moveType: 'transfer_out' }))
    moves.push(await writeMove(ctx, doc, { ...move, warehouse: to, qtyDelta: line.qty, moveType: 'transfer_in' }))
  }

  return moves
}

const idOf = (value: string | { id: string }) => (typeof value === 'object' ? value.id : value)

/**
 * Сторно рухів: компенсуючі рядки з `reversalOf` і тими самими кількістю й вартістю зі знаком мінус.
 * Повернення приходу списує умовно (нестача ⇒ `InsufficientStockError`) і підпорядковується
 * правилам `qty = 0 ⇒ value = 0` та забороні від'ємної вартості. Повторне сторно заборонене.
 */
export const revert = async (
  req: PayloadRequest,
  {
    doc,
    date,
    moves,
    moveType = 'reversal',
  }: BaseArgs & { moves: StockMove[]; moveType?: Extract<MoveType, 'reversal' | 'sale_cancel'> },
): Promise<StockMove[]> => {
  const ctx = await openContext(req, date)

  const reverted = await req.payload.find({
    collection: 'stock-moves',
    where: { reversalOf: { in: moves.map((move) => move.id) } },
    pagination: false,
    depth: 0,
    req,
  })
  if (reverted.docs.length > 0) {
    throw new AlreadyRevertedError(reverted.docs.map((move) => idOf(move.reversalOf as string)))
  }

  const lines = moves.map((move) => ({
    move,
    product: idOf(move.product),
    warehouse: idOf(move.warehouse),
    qty: -move.qtyDelta,
  }))

  // Спершу всі умовні списання (повернення приходів), щоб нестачі прийшли одним списком.
  await decreaseBalances(
    ctx,
    byProductAndWarehouse(lines.filter((line) => line.qty < 0).map((line) => ({ ...line, qty: -line.qty }))),
  )

  const result: StockMove[] = []
  for (const line of lines) {
    if (line.qty > 0) await increaseBalance(ctx, line.product, line.warehouse, line.qty)

    const { valueDeltaBani, unitCostBani } = TRANSFER_TYPES.includes(line.move.moveType)
      ? { valueDeltaBani: 0, unitCostBani: await readUnitCost(ctx, line.product) }
      : await changeCost(ctx, line.product, line.qty, -line.move.valueDeltaBani)

    result.push(
      await writeMove(ctx, doc, {
        product: line.product,
        warehouse: line.warehouse,
        qtyDelta: line.qty,
        valueDeltaBani,
        unitCostBani,
        moveType,
        reversalOf: line.move.id,
      }),
    )
  }

  return result
}
