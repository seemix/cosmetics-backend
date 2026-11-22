import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkStockCache } from '@/endpoints/stockCacheCheck'
import { down, up } from '@/migrations/20261122_100000_reserve_pending_orders'
import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { cleanupStock, deleteDocumentsDirectly, stockUp } from './helpers/stock'

let payload: Payload
let data: TestData
let warehouse: string
let p: string
let q: string

const tag = `MRSV-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: Record<string, string> = {}

const oid = (id: string) => new payload.db.collections.orders.base.Types.ObjectId(id)
const rawOrders = () => payload.db.collections.orders.collection
const rawBalances = () => payload.db.collections['stock-balances'].collection

/** Міграція так, як її запускає Payload: `req` з відкритою транзакцією і її сесія. */
const runMigration = async (fn: typeof up | typeof down) => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const session = payload.db.sessions?.[(await req.transactionID) as string]
    await fn({ payload, req, session } as never)
    await commitTransaction(req)
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

/** Замовлення у форматі до В23: без полів резерву. */
const insertOrder = async (
  key: string,
  status: string,
  items: Array<{ product: string; quantity: number }>,
  createdAt: Date,
  accounting: Record<string, unknown> = { stockTracked: true, stockPostedAt: null },
) => {
  const { insertedId } = await rawOrders().insertOne({
    orderNumber: `${tag}-${key}`,
    status,
    source: 'admin',
    warehouse: oid(warehouse),
    items: items.map((item) => ({ id: `${key}-${item.product}`, product: oid(item.product), quantity: item.quantity, price: 1 })),
    accounting,
    createdAt,
    updatedAt: createdAt,
  })
  orders[key] = String(insertedId)
}

const order = (key: string) => rawOrders().findOne({ _id: oid(orders[key]) })
const balance = (product: string) => rawBalances().findOne({ product: oid(product), warehouse: oid(warehouse) })
const day = (n: number) => new Date(Date.UTC(2026, 9, n))

describe('R9, В23: міграція резерву наявних замовлень', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    const brand = String((await data.brand()).id)
    for (const _ of [1, 2]) products.push(String((await data.product({ brand, retailPrice: 100 })).id))
    ;[p, q] = products

    const doc = await payload.create({ collection: 'warehouses', data: { name: tag, code: tag } })
    warehouse = String(doc.id)
    warehouses.push(warehouse)

    await stockUp(payload, p, warehouse, 5, 500)
    await stockUp(payload, q, warehouse, 2, 200)
    // Кеш у форматі до В23: поля reserved немає.
    await rawBalances().updateMany({ product: { $in: [oid(p), oid(q)] } }, { $unset: { reserved: '' } })

    // Найстаріше бере 3 з 5 P; наступне просить ще 3 P і 1 Q — не вистачає P, усе замовлення в backorder.
    await insertOrder('first', 'pending', [{ product: p, quantity: 3 }], day(1))
    await insertOrder('short', 'paid', [{ product: p, quantity: 3 }, { product: q, quantity: 1 }], day(2))
    // Однаковий товар у двох рядках сумується.
    await insertOrder('fits', 'pending', [{ product: p, quantity: 1 }, { product: p, quantity: 1 }, { product: q, quantity: 2 }], day(3))
    // Не чіпаються: історичне, проведене, скасоване.
    await insertOrder('historical', 'pending', [{ product: p, quantity: 1 }], day(4), {})
    await insertOrder('posted', 'shipped', [{ product: p, quantity: 1 }], day(5), { stockTracked: true, stockPostedAt: day(5) })
    await insertOrder('cancelled', 'cancelled', [{ product: p, quantity: 1 }], day(6))
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'orders', Object.values(orders))
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  it('up резервує від найстарішого, нестачу переводить у backorder, решту не чіпає', async () => {
    await runMigration(up)

    expect(await balance(p)).toMatchObject({ qty: 5, reserved: 5 })
    expect(await balance(q)).toMatchObject({ qty: 2, reserved: 2 })

    const first = await order('first')
    expect(first?.status).toBe('pending')
    expect(first?.accounting.reservedItems).toEqual([
      expect.objectContaining({ product: oid(p), warehouse: oid(warehouse), qty: 3 }),
    ])
    expect(first?.accounting.reservedAt).toEqual(day(1))
    expect(first?.accounting.shortages).toEqual([])

    const short = await order('short')
    expect(short?.status).toBe('backorder')
    expect(short?.accounting.reservedItems).toEqual([])
    expect(short?.accounting.reservedAt).toBeNull()
    expect(short?.accounting.shortages).toEqual([
      expect.objectContaining({ product: oid(p), warehouse: oid(warehouse), requested: 3, available: 2 }),
    ])

    const fits = await order('fits')
    expect(fits?.status).toBe('pending')
    expect(fits?.accounting.reservedItems).toHaveLength(2)
    expect(fits?.accounting.reservedAt).toEqual(day(3))

    for (const key of ['historical', 'posted', 'cancelled']) {
      const untouched = await order(key)
      expect(untouched?.accounting).not.toHaveProperty('reservedItems')
      expect(untouched?.accounting).not.toHaveProperty('shortages')
    }
    expect((await order('posted'))?.status).toBe('shipped')

    // Кеш резерву збігається зі знімками замовлень.
    const discrepancies = await checkStockCache(await createLocalReq({}, payload))
    expect(discrepancies.filter((item) => products.includes(item.product))).toEqual([])

    // Повторний запуск нічого не змінює: зарезервовані замовлення пропускаються.
    await runMigration(up)
    expect(await balance(p)).toMatchObject({ reserved: 5 })
  })

  it('down знімає резерв, прибирає поля й повертає backorder у pending', async () => {
    await runMigration(down)

    expect(await balance(p)).toMatchObject({ qty: 5, reserved: 0 })
    expect(await balance(q)).toMatchObject({ qty: 2, reserved: 0 })
    const short = await order('short')
    expect(short?.status).toBe('pending')
    for (const key of ['first', 'short', 'fits']) {
      const doc = await order(key)
      expect(doc?.accounting).not.toHaveProperty('reservedItems')
      expect(doc?.accounting).not.toHaveProperty('reservedAt')
      expect(doc?.accounting).not.toHaveProperty('shortages')
    }

    // Лишаємо тестову БД у новому форматі.
    await runMigration(up)
    expect(await balance(p)).toMatchObject({ reserved: 5 })
  })
})
