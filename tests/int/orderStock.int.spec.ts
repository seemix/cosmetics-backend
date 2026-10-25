import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { InsufficientStockError } from '@/services/stock/errors'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'
import {
  cleanupStock,
  costOf,
  createAdmin,
  movesOfDoc,
  qtyAt,
  stockUp,
  type AuthUser,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brand: string
let webWarehouse: string
let adminWarehouse: string
let previousSettings: Record<string, unknown>

const tag = `OSTK-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const setStockControl = (enabled: boolean) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: enabled } as never })

const newProduct = async (retailPrice = 100) => {
  const id = String((await data.product({ brand, retailPrice })).id)
  products.push(id)
  return id
}

const ordersWith = async (product: string) =>
  (await payload.count({ collection: 'orders', where: { 'items.product': { equals: product } } })).totalDocs

/** Виклики `payload.create` саме для замовлень (рухи журналу теж ідуть через `create`). */
const orderCreates = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([args]) => (args as { collection?: string }).collection === 'orders').length

const createWeb = async (items: Array<{ product: string; quantity: number }>) => {
  const response = await callCreateOrder(payload, { body: { items, shippingAddress } })
  if (response.status === 201) orders.push(String(response.body.order.id))
  return response
}

describe('S2.3/S2.4: списання при створенні замовлення', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)

    for (const code of ['web', 'admin']) {
      const doc = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(doc.id))
    }
    ;[webWarehouse, adminWarehouse] = warehouses

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: {
        stockControlEnabled: true,
        defaultWebWarehouse: webWarehouse,
        defaultAdminWarehouse: adminWarehouse,
      } as never,
    })
  })

  beforeEach(() => {
    vi.mocked(payload.sendEmail).mockClear()
  })

  afterAll(async () => {
    // Спершу прапорець окремо: решта тестів не повинна працювати з увімкненим обліком.
    await setStockControl(previousSettings.stockControlEnabled === true)
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    for (const id of orders) await payload.delete({ collection: 'orders', id }).catch(() => {})
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('облік вимкнено: замовлення створюється без списання й без рухів', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 5, 50000)
    await setStockControl(false)

    try {
      const { status, body } = await createWeb([{ product, quantity: 2 }])
      expect(status).toBe(201)

      const order = await loadOrder(payload, data, body.order.id)
      expect(order.accounting?.stockPostedAt ?? null).toBeNull()
      expect(order.accounting?.cogsBani ?? null).toBeNull()
      expect(await qtyAt(payload, product, webWarehouse)).toBe(5)
      expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
    } finally {
      await setStockControl(true)
    }
  })

  it('замовлення сайту списує зі складу сайту: собівартість, stockPostedAt, рухи по позиціях', async () => {
    const a = await newProduct(200)
    const b = await newProduct(50)
    // Середня A: 173 735 / 14 (розд. 5.3), продаж 3 шт. = 37 229.
    await stockUp(payload, a, webWarehouse, 14, 173735)
    await stockUp(payload, b, webWarehouse, 4, 10000)

    const { status, body } = await createWeb([
      { product: a, quantity: 3 },
      { product: b, quantity: 1 },
    ])
    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(Object.keys(body.order).sort()).toEqual(['id', 'items', 'orderNumber'])

    const order = await loadOrder(payload, data, body.order.id)
    expect(order.accounting?.stockPostedAt).toBeTruthy()
    expect(order.accounting?.cogsBani).toBe(37229 + 2500)

    expect(await qtyAt(payload, a, webWarehouse)).toBe(11)
    expect(await costOf(payload, a)).toEqual({ qty: 11, valueBani: 136506 })
    expect(await qtyAt(payload, b, webWarehouse)).toBe(3)

    const moves = await movesOfDoc(payload, 'orders', order.id)
    expect(
      moves
        .map((move) => ({
          product: idOf(move.product),
          warehouse: idOf(move.warehouse),
          qtyDelta: move.qtyDelta,
          valueDeltaBani: move.valueDeltaBani,
          moveType: move.moveType,
          docNumber: move.docNumber,
        }))
        .sort((x, y) => x.product.localeCompare(y.product)),
    ).toEqual(
      [
        { product: a, qtyDelta: -3, valueDeltaBani: -37229 },
        { product: b, qtyDelta: -1, valueDeltaBani: -2500 },
      ]
        .map((move) => ({ ...move, warehouse: webWarehouse, moveType: 'sale', docNumber: order.orderNumber }))
        .sort((x, y) => x.product.localeCompare(y.product)),
    )
    expect(new Date(moves[0].date).toISOString()).toBe(new Date(order.accounting!.stockPostedAt!).toISOString())
  })

  it('нестача: 409 з деталями, замовлення немає, кеш незмінний, сповіщень немає', async () => {
    const enough = await newProduct()
    const scarce = await newProduct()
    await stockUp(payload, enough, webWarehouse, 5, 5000)
    await stockUp(payload, scarce, webWarehouse, 1, 1000)

    const { status, body } = await createWeb([
      { product: enough, quantity: 2 },
      { product: scarce, quantity: 2 },
    ])

    expect(status).toBe(409)
    expect(body).toEqual({
      success: false,
      code: 'INSUFFICIENT_STOCK',
      message: expect.any(String),
      items: [{ product: scarce, requested: 2, available: 1 }],
    })
    expect(await ordersWith(enough)).toBe(0)
    expect(await qtyAt(payload, enough, webWarehouse)).toBe(5)
    expect(await costOf(payload, enough)).toEqual({ qty: 5, valueBani: 5000 })
    expect(await qtyAt(payload, scarce, webWarehouse)).toBe(1)
    expect(payload.sendEmail).not.toHaveBeenCalled()
  })

  it('створення з адмінки (Local API з admin) списує зі складу замовлення', async () => {
    const product = await newProduct(100)
    await stockUp(payload, product, adminWarehouse, 3, 3000)

    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 2, price: 0 }], total: 0 } as never,
      depth: 0,
    })
    orders.push(String(order.id))

    expect(idOf(order.warehouse)).toBe(adminWarehouse)
    expect(order.accounting?.stockPostedAt).toBeTruthy()
    expect(order.accounting?.cogsBani).toBe(2000)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(1)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(1)
  })

  it('з адмінки нестача відхиляє збереження з текстом мовою адмінки', async () => {
    const product = await newProduct()
    await stockUp(payload, product, adminWarehouse, 1, 1000)

    const error = await payload
      .create({
        collection: 'orders',
        user: admin,
        data: { items: [{ product, quantity: 2, price: 0 }], total: 0 } as never,
        depth: 0,
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(InsufficientStockError)
    expect((error as Error).message).toMatch(new RegExp(`${tag} admin.*2.*1`))
    expect(await ordersWith(product)).toBe(0)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(1)
  })

  it('значення accounting з тіла запиту не проводять замовлення', async () => {
    const product = await newProduct()
    await stockUp(payload, product, adminWarehouse, 2, 2000)
    await setStockControl(false)

    try {
      const order = await payload.create({
        collection: 'orders',
        user: admin,
        data: {
          items: [{ product, quantity: 1, price: 0 }],
          total: 0,
          accounting: { stockPostedAt: new Date().toISOString(), cogsBani: 999 },
        } as never,
        depth: 0,
      })
      orders.push(String(order.id))

      expect(order.accounting?.stockPostedAt ?? null).toBeNull()
      expect(order.accounting?.cogsBani ?? null).toBeNull()
      expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
    } finally {
      await setStockControl(true)
    }
  })

  it('паралельні гостьові замовлення останньої одиниці: одне 201, одне 409', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 1, 1000)

    const responses = await Promise.all([
      createWeb([{ product, quantity: 1 }]),
      createWeb([{ product, quantity: 1 }]),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(responses.find((response) => response.status === 409)?.body.code).toBe('INSUFFICIENT_STOCK')
    expect(await ordersWith(product)).toBe(1)
    expect(await qtyAt(payload, product, webWarehouse)).toBe(0)
    expect(await costOf(payload, product)).toEqual({ qty: 0, valueBani: 0 })
  })

  it('транзієнтна помилка повторює транзакцію, інша помилка дає 500 без повторів', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 2, 2000)
    const create = vi.spyOn(payload, 'create')

    try {
      create.mockRejectedValueOnce(Object.assign(new Error('Write conflict'), { code: 112, codeName: 'WriteConflict' }))
      const retried = await createWeb([{ product, quantity: 1 }])
      expect(retried.status).toBe(201)
      expect(orderCreates(create)).toBe(2)
      expect(await ordersWith(product)).toBe(1)
      expect(await qtyAt(payload, product, webWarehouse)).toBe(1)

      create.mockClear()
      create.mockRejectedValueOnce(new Error('boom'))
      const failed = await createWeb([{ product, quantity: 1 }])
      expect(failed.status).toBe(500)
      expect(orderCreates(create)).toBe(1)
      expect(await qtyAt(payload, product, webWarehouse)).toBe(1)
    } finally {
      create.mockRestore()
    }
  })
})
