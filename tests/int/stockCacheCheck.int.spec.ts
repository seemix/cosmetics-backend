import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  checkStockCache,
  fixStockCache,
  type StockCacheDiscrepancy,
  stockCacheCheck,
  stockCacheRebuild,
} from '@/endpoints/stockCacheCheck'
import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { cleanupStock, costOf, deleteDocumentsDirectly, qtyAt, sellFrom, stockUp } from './helpers/stock'

let payload: Payload
let data: TestData
let brandId: string
let mainId: string
let shopId: string

const tag = `CCHK-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

/** Розбіжності лише по тестових товарах: у спільній БД можуть бути чужі. */
const mine = (items: StockCacheDiscrepancy[]) => items.filter((item) => products.includes(item.product))
const found = async () => mine(await checkStockCache(await createLocalReq({}, payload)))

const cacheDoc = async (collection: 'stock-balances' | 'product-costs', product: string, warehouse?: string) =>
  (
    await payload.find({
      collection,
      where: { product: { equals: product }, ...(warehouse ? { warehouse: { equals: warehouse } } : {}) },
      depth: 0,
    })
  ).docs[0]

const callEndpoint = async (endpoint: typeof stockCacheCheck, roles?: Array<'admin' | 'customer'>) => {
  const req = await createLocalReq(
    { user: roles ? ({ id: 'u', roles, collection: 'users' } as never) : undefined },
    payload,
  )
  const response = await endpoint.handler(req)

  return { status: response.status, body: await response.json() }
}

describe('A13: перевірка й перебудова кешу залишків', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    brandId = String((await data.brand()).id)

    for (const code of ['main', 'shop']) {
      const warehouse = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(warehouse.id))
    }
    ;[mainId, shopId] = warehouses
  })

  afterAll(async () => {
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  it('кеш, зібраний сервісом, збігається з журналом', async () => {
    const product = await newProduct()
    await stockUp(payload, product, mainId, 14, 173735)
    await stockUp(payload, product, shopId, 2, 1000)
    await sellFrom(payload, product, mainId, 3)

    expect(await found()).toEqual([])
  })

  it('check знаходить ручне псування кешу, fix виправляє з журналу', async () => {
    const [a, b, c, stray] = [await newProduct(), await newProduct(), await newProduct(), await newProduct()]
    await stockUp(payload, a, mainId, 10, 5000)
    await stockUp(payload, b, mainId, 4, 800)
    await stockUp(payload, b, shopId, 6, 1200)
    await stockUp(payload, c, mainId, 3, 300)

    // Псуємо кеш напряму, повз сервіс: Local API з overrideAccess за замовчуванням дозволений.
    const balanceA = await cacheDoc('stock-balances', a, mainId)
    await payload.update({ collection: 'stock-balances', id: balanceA.id, data: { qty: 99 } })
    const costB = await cacheDoc('product-costs', b)
    await payload.update({ collection: 'product-costs', id: costB.id, data: { valueBani: 1 } })
    const balanceC = await cacheDoc('stock-balances', c, mainId)
    await payload.delete({ collection: 'stock-balances', id: balanceC.id })
    const costC = await cacheDoc('product-costs', c)
    await payload.delete({ collection: 'product-costs', id: costC.id })
    // Кеш без жодного руху в журналі.
    await payload.create({ collection: 'stock-balances', data: { product: stray, warehouse: mainId, qty: 7 } })
    await payload.create({ collection: 'product-costs', data: { product: stray, qty: 7, valueBani: 70 } })

    const discrepancies = await found()

    expect(discrepancies).toEqual(
      expect.arrayContaining([
        { type: 'balance', product: a, warehouse: mainId, expectedQty: 10, actualQty: 99 },
        { type: 'cost', product: b, expectedQty: 10, expectedValueBani: 2000, actualQty: 10, actualValueBani: 1 },
        { type: 'balance', product: c, warehouse: mainId, expectedQty: 3, actualQty: null },
        {
          type: 'cost',
          product: c,
          expectedQty: 3,
          expectedValueBani: 300,
          actualQty: null,
          actualValueBani: null,
        },
        { type: 'balance', product: stray, warehouse: mainId, expectedQty: 0, actualQty: 7 },
        { type: 'cost', product: stray, expectedQty: 0, expectedValueBani: 0, actualQty: 7, actualValueBani: 70 },
      ]),
    )
    expect(discrepancies).toHaveLength(6)

    // check нічого не змінює.
    expect((await cacheDoc('stock-balances', a, mainId)).qty).toBe(99)

    const fixed = mine(await fixStockCache(await createLocalReq({}, payload)))
    expect(fixed).toHaveLength(6)

    expect(await found()).toEqual([])
    expect(await qtyAt(payload, a, mainId)).toBe(10)
    expect(await costOf(payload, b)).toEqual({ qty: 10, valueBani: 2000 })
    expect(await qtyAt(payload, c, mainId)).toBe(3)
    expect(await costOf(payload, c)).toEqual({ qty: 3, valueBani: 300 })
    expect(await qtyAt(payload, stray, mainId)).toBe(0)
    expect(await costOf(payload, stray)).toEqual({ qty: 0, valueBani: 0 })
  })

  it('fix зберігає lastPurchaseUnitCostBani і не створює порожніх документів', async () => {
    const product = await newProduct()
    const cost = await payload.create({
      collection: 'product-costs',
      data: { product, qty: 5, valueBani: 500, lastPurchaseUnitCostBani: 123.5 },
    })

    await fixStockCache(await createLocalReq({}, payload))

    const after = await payload.findByID({ collection: 'product-costs', id: cost.id })
    expect(after).toMatchObject({ qty: 0, valueBani: 0, lastPurchaseUnitCostBani: 123.5 })
    expect(await found()).toEqual([])
  })

  describe('R2 (В23): резерв у кеші й знімки замовлень', () => {
    const orders: string[] = []

    /** Сирий документ замовлення: `accounting.reservedItems` ще може не бути в схемі (R3). */
    const orderWithReservation = async (status: string, items: Array<[string, string, number]>) => {
      const model = payload.db.collections.orders
      const objectId = (id: string) => new model.base.Types.ObjectId(id)
      const result = await model.collection.insertOne({
        status,
        accounting: {
          reservedItems: items.map(([product, warehouse, qty]) => ({
            product: objectId(product),
            warehouse: objectId(warehouse),
            qty,
          })),
          reservedAt: new Date(),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      orders.push(String(result.insertedId))
    }

    afterAll(async () => {
      await deleteDocumentsDirectly(payload, 'orders', orders)
    })

    it('без резервів розбіжностей немає, відсутнє поле reserved = 0', async () => {
      const product = await newProduct()
      await stockUp(payload, product, mainId, 5, 500)
      const balance = await cacheDoc('stock-balances', product, mainId)
      const model = payload.db.collections['stock-balances']
      await model.collection.updateOne({ _id: new model.base.Types.ObjectId(String(balance.id)) }, { $unset: { reserved: '' } })

      expect(await found()).toEqual([])
    })

    it('check знаходить розбіжність резерву, fix виставляє reserved за знімками', async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()]
      await stockUp(payload, a, mainId, 10, 1000)
      await stockUp(payload, b, mainId, 6, 600)

      // a: два замовлення тримають 2 + 3, у кеші 0.
      await orderWithReservation('pending', [[a, mainId, 2]])
      await orderWithReservation('paid', [
        [a, mainId, 3],
        [c, shopId, 1],
      ])
      // Знімки в інших статусах резерву не тримають.
      await orderWithReservation('shipped', [[a, mainId, 4]])
      await orderWithReservation('cancelled', [[b, mainId, 2]])
      // b: у кеші 4 без жодного замовлення.
      const balanceB = await cacheDoc('stock-balances', b, mainId)
      await payload.update({ collection: 'stock-balances', id: balanceB.id, data: { reserved: 4 } })

      const discrepancies = await found()
      expect(discrepancies).toEqual(
        expect.arrayContaining([
          { type: 'reserved', product: a, warehouse: mainId, expectedReserved: 5, actualReserved: 0 },
          { type: 'reserved', product: b, warehouse: mainId, expectedReserved: 0, actualReserved: 4 },
          // c: документа кешу на складі shop немає.
          { type: 'reserved', product: c, warehouse: shopId, expectedReserved: 1, actualReserved: null },
        ]),
      )
      expect(discrepancies).toHaveLength(3)

      const fixed = mine(await fixStockCache(await createLocalReq({}, payload)))
      expect(fixed).toHaveLength(3)

      expect(await found()).toEqual([])
      expect(await cacheDoc('stock-balances', a, mainId)).toMatchObject({ qty: 10, reserved: 5 })
      expect(await cacheDoc('stock-balances', b, mainId)).toMatchObject({ qty: 6, reserved: 0 })
      expect(await cacheDoc('stock-balances', c, shopId)).toMatchObject({ qty: 0, reserved: 1 })
    })
  })

  describe('ендпоінти: доступ лише admin', () => {
    it('GET /stock/cache-check', async () => {
      expect(await callEndpoint(stockCacheCheck)).toMatchObject({ status: 401 })
      expect(await callEndpoint(stockCacheCheck, ['customer'])).toMatchObject({ status: 403 })

      const product = await newProduct()
      await stockUp(payload, product, mainId, 2, 200)
      const balance = await cacheDoc('stock-balances', product, mainId)
      await payload.update({ collection: 'stock-balances', id: balance.id, data: { qty: 5 } })

      const { status, body } = await callEndpoint(stockCacheCheck, ['admin'])
      expect(status).toBe(200)
      expect(body.ok).toBe(false)
      expect(body.discrepancies).toEqual(
        expect.arrayContaining([{ type: 'balance', product, warehouse: mainId, expectedQty: 2, actualQty: 5 }]),
      )
      // Перевірка нічого не виправила.
      expect((await cacheDoc('stock-balances', product, mainId)).qty).toBe(5)
    })

    it('POST /stock/cache-rebuild', async () => {
      expect(await callEndpoint(stockCacheRebuild)).toMatchObject({ status: 401 })
      expect(await callEndpoint(stockCacheRebuild, ['customer'])).toMatchObject({ status: 403 })

      const product = await newProduct()
      await stockUp(payload, product, mainId, 2, 200)
      const balance = await cacheDoc('stock-balances', product, mainId)
      await payload.update({ collection: 'stock-balances', id: balance.id, data: { qty: 5 } })

      // Customer не змінив нічого.
      await callEndpoint(stockCacheRebuild, ['customer'])
      expect((await cacheDoc('stock-balances', product, mainId)).qty).toBe(5)

      const { status, body } = await callEndpoint(stockCacheRebuild, ['admin'])
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.fixed).toEqual(
        expect.arrayContaining([{ type: 'balance', product, warehouse: mainId, expectedQty: 2, actualQty: 5 }]),
      )
      expect((await cacheDoc('stock-balances', product, mainId)).qty).toBe(2)
    })
  })
})
