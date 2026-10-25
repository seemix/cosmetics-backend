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
import { cleanupStock, costOf, qtyAt, sellFrom, stockUp } from './helpers/stock'

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
