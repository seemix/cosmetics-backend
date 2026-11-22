import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { InsufficientStockError, isTransientTransactionError } from '@/services/stock/errors'
import { assertAvailable, issue, release, reserve, transfer } from '@/services/stock/stockLedger.service'

import { TestData } from './helpers/fixtures'
import {
  type AuthUser,
  cleanupStock,
  costOf,
  createAdmin,
  deleteDocumentsDirectly,
  inTransaction,
  stockUp,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brandId: string
let warehouseId: string
let otherWarehouseId: string

const tag = `RSV-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const adjustments: Array<number | string> = []
const doc = { collection: 'test-docs', id: `${tag}-doc` }

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

const balanceAt = async (product: string, warehouse = warehouseId) => {
  const found = (
    await payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouse } },
      depth: 0,
    })
  ).docs[0]

  return { qty: found?.qty ?? 0, reserved: found?.reserved ?? 0 }
}

const movesCount = async (product: string) =>
  (await payload.count({ collection: 'stock-moves', where: { product: { equals: product } } })).totalDocs

const reserveIn = (product: string, qty: number, warehouse = warehouseId) =>
  inTransaction(payload, (req) => reserve(req, [{ product, warehouse, qty }]))

const releaseIn = (product: string, qty: number, warehouse = warehouseId) =>
  inTransaction(payload, (req) => release(req, [{ product, warehouse, qty }]))

const insufficient = async (promise: Promise<unknown>) => {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(InsufficientStockError)
  return (error as InsufficientStockError).items
}

describe('R1 (В23): резерв у кеші залишків', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    brandId = String((await data.brand()).id)

    for (const code of ['a', 'b']) {
      const warehouse = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(warehouse.id))
    }
    ;[warehouseId, otherWarehouseId] = warehouses
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'stock-adjustments', adjustments)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  it('reserve і release змінюють лише reserved: qty, собівартість і журнал без змін', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 5, 500)
    const moves = await movesCount(product)

    // Рядки одного товару й складу зводяться.
    await inTransaction(payload, (req) =>
      reserve(req, [
        { product, warehouse: warehouseId, qty: 2 },
        { product, warehouse: warehouseId, qty: 1 },
      ]),
    )
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 3 })
    expect(await costOf(payload, product)).toEqual({ qty: 5, valueBani: 500 })
    expect(await movesCount(product)).toBe(moves)

    await releaseIn(product, 3)
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 0 })
    expect(await costOf(payload, product)).toEqual({ qty: 5, valueBani: 500 })
    expect(await movesCount(product)).toBe(moves)
  })

  it('документ без поля reserved трактується як 0', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 2, 200)
    const model = payload.db.collections['stock-balances']
    await model.collection.updateOne(
      { product: new model.base.Types.ObjectId(product) },
      { $unset: { reserved: '' } },
    )

    await reserveIn(product, 2)
    expect(await balanceAt(product)).toEqual({ qty: 2, reserved: 2 })
  })

  it('reserve понад доступне кидає повний список нестач і нічого не резервує', async () => {
    const product = await newProduct()
    const other = await newProduct()
    const missing = await newProduct()
    await stockUp(payload, product, warehouseId, 5, 500)
    await stockUp(payload, other, warehouseId, 3, 300)
    await reserveIn(product, 4)

    const items = await insufficient(
      inTransaction(payload, (req) =>
        reserve(req, [
          { product, warehouse: warehouseId, qty: 2 },
          { product: other, warehouse: warehouseId, qty: 1 },
          { product: other, warehouse: warehouseId, qty: 3 },
          { product: missing, warehouse: warehouseId, qty: 1 },
        ]),
      ),
    )

    expect(items).toHaveLength(3)
    expect(items).toEqual(
      expect.arrayContaining([
        { product, warehouse: warehouseId, requested: 2, available: 1 },
        { product: other, warehouse: warehouseId, requested: 4, available: 3 },
        { product: missing, warehouse: warehouseId, requested: 1, available: 0 },
      ]),
    )
    // Транзакція відкотилась, навіть успішні рядки.
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 4 })
    expect(await balanceAt(other)).toEqual({ qty: 3, reserved: 0 })
  })

  it('release понад резерв кидає помилку розсинхрону й відкочується', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 5, 500)
    await reserveIn(product, 2)

    await expect(releaseIn(product, 3)).rejects.toThrow(/out of sync/)
    await expect(releaseIn(product, 1, otherWarehouseId)).rejects.toThrow(/out of sync/)
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 2 })
  })

  it('issue, transfer і assertAvailable не беруть зарезервоване', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 5, 500)
    await reserveIn(product, 3)

    const sale = await insufficient(
      inTransaction(payload, (req) =>
        issue(req, { doc, moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 3 }] }),
      ),
    )
    expect(sale).toEqual([{ product, warehouse: warehouseId, requested: 3, available: 2 }])

    const moved = await insufficient(
      inTransaction(payload, (req) =>
        transfer(req, { doc, from: warehouseId, to: otherWarehouseId, lines: [{ product, qty: 3 }] }),
      ),
    )
    expect(moved).toEqual([{ product, warehouse: warehouseId, requested: 3, available: 2 }])

    await insufficient(
      inTransaction(payload, (req) => assertAvailable(req, [{ product, warehouse: warehouseId, qty: 3 }])),
    )
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 3 })

    // Вільне списується й переміщується.
    await inTransaction(payload, (req) =>
      issue(req, { doc, moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 1 }] }),
    )
    await inTransaction(payload, (req) =>
      transfer(req, { doc, from: warehouseId, to: otherWarehouseId, lines: [{ product, qty: 1 }] }),
    )
    expect(await balanceAt(product)).toEqual({ qty: 3, reserved: 3 })
    expect(await balanceAt(product, otherWarehouseId)).toEqual({ qty: 1, reserved: 0 })
  })

  it('списання з інвентаризації дозволене нижче резерву, але не нижче 0; звичайне списання — ні', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 5, 500)
    await reserveIn(product, 4)

    const createAdjustment = async (
      kind: 'writeoff' | 'inventory',
      line: { product: string; quantity?: number; countedQty?: number },
    ) => {
      const draft = await payload.create({
        collection: 'stock-adjustments',
        data: {
          status: 'draft',
          documentDate: '2026-11-22T00:00:00.000Z',
          kind,
          warehouse: warehouseId,
          lines: [line],
          ...(kind === 'writeoff' ? { reason: 'damage' as const } : {}),
        },
        ...asAdmin,
      })
      adjustments.push(draft.id)
      return payload.update({ collection: 'stock-adjustments', id: draft.id, data: { status: 'posted' }, ...asAdmin })
    }

    // Звичайне списання 2 шт. при доступних 1 відхиляється.
    await expect(createAdjustment('writeoff', { product, quantity: 2 })).rejects.toBeInstanceOf(InsufficientStockError)
    expect(await balanceAt(product)).toEqual({ qty: 5, reserved: 4 })

    // Інвентаризація нарахувала 2: нестача 3 списується, reserved > qty — перепродаж.
    await createAdjustment('inventory', { product, countedQty: 2 })
    expect(await balanceAt(product)).toEqual({ qty: 2, reserved: 4 })

    // Нижче 0 не можна навіть з allowBelowReserved.
    await insufficient(
      inTransaction(payload, (req) =>
        issue(req, {
          doc,
          moveType: 'inventory',
          allowBelowReserved: true,
          lines: [{ product, warehouse: warehouseId, qty: 3 }],
        }),
      ),
    )
    expect(await balanceAt(product)).toEqual({ qty: 2, reserved: 4 })

    // При перепродажі доступно 0, а не від'ємне.
    const items = await insufficient(reserveIn(product, 1))
    expect(items).toEqual([{ product, warehouse: warehouseId, requested: 1, available: 0 }])
  })

  it('паралельні reserve на останню одиницю: успішний рівно один', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 1, 100)

    const results = await Promise.allSettled([reserveIn(product, 1), reserveIn(product, 1)])
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(reason instanceof InsufficientStockError || isTransientTransactionError(reason)).toBe(true)
    expect(await balanceAt(product)).toEqual({ qty: 1, reserved: 1 })
  })
})
