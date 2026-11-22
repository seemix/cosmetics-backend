import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

import { InsufficientStockError, type StockShortage } from '@/services/stock/errors'
import { release, reserve } from '@/services/stock/stockLedger.service'

type ObjectIdLike = { toString(): string }
type OrderDoc = {
  _id: ObjectIdLike
  orderNumber?: string
  createdAt?: Date
  warehouse?: ObjectIdLike | null
  items?: Array<{ product?: ObjectIdLike | null; quantity?: number }>
}
type Line = { product: string; warehouse: string; qty: number }

const RESERVING_STATUSES = ['pending', 'paid']

/** Позиції замовлення на його складі; однакові товари сумуються, порядок стабільний. */
const linesOf = (order: OrderDoc): Line[] => {
  const warehouse = order.warehouse ? String(order.warehouse) : null
  if (!warehouse) return []
  const totals = new Map<string, Line>()

  for (const item of order.items ?? []) {
    if (!item?.product) continue
    const product = String(item.product)
    const line = totals.get(product) ?? { product, warehouse, qty: 0 }
    line.qty += Number(item.quantity) || 0
    totals.set(product, line)
  }

  return [...totals.values()].filter((line) => line.qty > 0).sort((a, b) => a.product.localeCompare(b.product))
}

/**
 * Резерв наявних замовлень (В23). Облікові непроведені замовлення в `pending`/`paid` без знімка резерву,
 * від найстарішого: якщо всіх позицій доступно (qty − reserved), вони резервуються зі знімком
 * `reservedAt = createdAt`; інакше замовлення стає `backorder` з переліком нестач. Історичні,
 * проведені й уже зарезервовані (створені після деплою R4) не змінюються. Усе в транзакції міграції.
 */
export async function up({ payload, req, session }: MigrateUpArgs): Promise<void> {
  const balances = payload.db.collections['stock-balances']
  const orders = payload.db.collections.orders
  const ObjectId = orders.base.Types.ObjectId
  const rowId = () => new ObjectId().toHexString()

  const filled = await balances.collection.updateMany(
    { reserved: { $exists: false } },
    { $set: { reserved: 0 } },
    { session },
  )

  const docs = await orders.collection
    .find<OrderDoc>(
      {
        status: { $in: RESERVING_STATUSES },
        'accounting.stockTracked': true,
        'accounting.stockPostedAt': null,
        'accounting.reservedItems.0': { $exists: false },
      },
      { session, sort: { createdAt: 1, _id: 1 } },
    )
    .toArray()

  const reserved: string[] = []
  const backordered: string[] = []
  const skipped: string[] = []

  for (const order of docs) {
    const number = order.orderNumber ?? String(order._id)
    const lines = linesOf(order)
    if (lines.length === 0) {
      skipped.push(number)
      continue
    }

    try {
      await reserve(req, lines)
    } catch (error) {
      if (!(error instanceof InsufficientStockError)) throw error
      // Рядки без нестачі встигли зарезервуватись: знімаємо, backorder резерву не тримає.
      const short = new Set(error.items.map((item) => `${item.product}:${item.warehouse}`))
      const partial = lines.filter((line) => !short.has(`${line.product}:${line.warehouse}`))
      if (partial.length > 0) await release(req, partial)

      await orders.collection.updateOne(
        { _id: order._id },
        {
          $set: {
            status: 'backorder',
            'accounting.reservedItems': [],
            'accounting.reservedAt': null,
            'accounting.shortages': error.items.map((item: StockShortage) => ({
              id: rowId(),
              product: new ObjectId(item.product),
              warehouse: new ObjectId(item.warehouse),
              requested: item.requested,
              available: item.available,
            })),
          },
        },
        { session },
      )
      backordered.push(number)
      continue
    }

    await orders.collection.updateOne(
      { _id: order._id },
      {
        $set: {
          'accounting.reservedItems': lines.map((line) => ({
            id: rowId(),
            product: new ObjectId(line.product),
            warehouse: new ObjectId(line.warehouse),
            qty: line.qty,
          })),
          'accounting.reservedAt': order.createdAt ?? new Date(),
          'accounting.shortages': [],
        },
      },
      { session },
    )
    reserved.push(number)
  }

  payload.logger.info(
    `reservations: reserved=0 set in ${filled.modifiedCount} stock-balances; ` +
      `reserved ${reserved.length} orders, moved ${backordered.length} to backorder` +
      (backordered.length > 0 ? ` (${backordered.join(', ')})` : ''),
  )
  if (skipped.length > 0) {
    payload.logger.warn(`reservations: ${skipped.length} orders without items or warehouse skipped (${skipped.join(', ')})`)
  }
}

/** Відкат: резервів немає, облікові поля резерву прибрано, `backorder` знову `pending`. */
export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const balances = payload.db.collections['stock-balances']
  const orders = payload.db.collections.orders

  const cleared = await balances.collection.updateMany({}, { $set: { reserved: 0 } }, { session })
  const backorders = await orders.collection.updateMany(
    { status: 'backorder' },
    { $set: { status: 'pending' } },
    { session },
  )
  await orders.collection.updateMany(
    {},
    { $unset: { 'accounting.reservedItems': '', 'accounting.reservedAt': '', 'accounting.shortages': '' } },
    { session },
  )

  payload.logger.info(
    `reservations: reserved=0 in ${cleared.modifiedCount} stock-balances, ${backorders.modifiedCount} backorders back to pending`,
  )
}
