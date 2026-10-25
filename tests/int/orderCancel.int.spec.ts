import { APIError, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import type { Order } from '@/payload-types'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import {
  cleanupStock,
  costOf,
  createAdmin,
  deleteDocumentsDirectly,
  movesOfDoc,
  qtyAt,
  stockUp,
  type AuthUser,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brand: string
let warehouse: string
let previousSettings: Record<string, unknown>

const tag = `OCNL-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const settings = (patch: Record<string, unknown>) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: patch as never })

const newProduct = async () => {
  const id = String((await data.product({ brand, retailPrice: 100 })).id)
  products.push(id)
  return id
}

/** Замовлення з адмінки на тестовому складі: проводиться, якщо облік увімкнено. */
const adminOrder = async (product: string, quantity: number): Promise<Order> => {
  const order = await payload.create({
    collection: 'orders',
    user: admin,
    data: { items: [{ product, quantity, price: 0 }], total: 0 } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  return order
}

const setStatus = (order: Order, status: Order['status']) =>
  payload.update({ collection: 'orders', id: order.id, user: admin, data: { status }, depth: 0 })

const rejection = (promise: Promise<unknown>) => promise.then(() => null, (reason: unknown) => reason)

describe('S2.5: скасування замовлення', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)

    const doc = await payload.create({ collection: 'warehouses', data: { name: `${tag} shop`, code: `${tag}-shop` } })
    warehouse = String(doc.id)
    warehouses.push(warehouse)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
      lockedUntil: before.lockedUntil ?? null,
    }
    await settings({ stockControlEnabled: true, defaultAdminWarehouse: warehouse, lockedUntil: null })
  })

  afterAll(async () => {
    // Спершу прапорець окремо: решта тестів не повинна працювати з увімкненим обліком.
    await settings({ stockControlEnabled: previousSettings.stockControlEnabled === true })
    await settings(previousSettings).catch(() => {})
    // Проведені замовлення хук видалення не дає прибрати.
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('продаж 3, скасування: повертає кількість і рівно собівартість продажу (розд. 5.3)', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 14, 173735)

    const order = await adminOrder(product, 3)
    expect(order.accounting?.cogsBani).toBe(37229)
    expect(await costOf(payload, product)).toEqual({ qty: 11, valueBani: 136506 })

    const cancelled = await setStatus(order, 'cancelled')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.accounting?.cancelledAt).toBeTruthy()
    expect(cancelled.accounting?.cogsBani).toBe(37229)

    expect(await qtyAt(payload, product, warehouse)).toBe(14)
    expect(await costOf(payload, product)).toEqual({ qty: 14, valueBani: 173735 })

    const [sale, cancel] = await movesOfDoc(payload, 'orders', order.id)
    expect(sale).toMatchObject({ moveType: 'sale', qtyDelta: -3, valueDeltaBani: -37229 })
    expect(cancel).toMatchObject({
      moveType: 'sale_cancel',
      qtyDelta: 3,
      valueDeltaBani: 37229,
      docNumber: order.orderNumber,
    })
    expect(idOf(cancel.reversalOf)).toBe(String(sale.id))
    expect(idOf(cancel.warehouse)).toBe(warehouse)
    expect(new Date(cancel.date).toISOString()).toBe(new Date(cancelled.accounting!.cancelledAt!).toISOString())
  })

  it('відвантажене замовлення теж скасовується з поверненням залишку (В5)', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)

    const order = await adminOrder(product, 2)
    await setStatus(order, 'shipped')
    await setStatus(order, 'cancelled')

    expect(await qtyAt(payload, product, warehouse)).toBe(2)
    expect(await costOf(payload, product)).toEqual({ qty: 2, valueBani: 2000 })
  })

  it('з cancelled вийти не можна; повторне збереження зі статусом cancelled не повертає вдруге', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)

    const order = await adminOrder(product, 1)
    await setStatus(order, 'cancelled')

    const error = await rejection(setStatus(order, 'pending'))
    expect(error).toBeInstanceOf(APIError)
    expect((error as APIError).status).toBe(409)

    await setStatus(order, 'cancelled')
    expect(await qtyAt(payload, product, warehouse)).toBe(2)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(2)
    expect((await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })).status).toBe('cancelled')
  })

  it('історичне замовлення (без проведення) лише змінює статус', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)
    await settings({ stockControlEnabled: false })

    try {
      const order = await adminOrder(product, 1)
      const cancelled = await setStatus(order, 'cancelled')

      expect(cancelled.status).toBe('cancelled')
      expect(cancelled.accounting?.cancelledAt ?? null).toBeNull()
      expect(await qtyAt(payload, product, warehouse)).toBe(2)
      expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
    } finally {
      await settings({ stockControlEnabled: true })
    }
  })

  it('оплачене замовлення не скасовується: статус і залишок незмінні', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)

    const order = await adminOrder(product, 1)
    await payload.update({ collection: 'orders', id: order.id, user: admin, data: { paidBani: 100 }, depth: 0 })

    const error = await rejection(setStatus(order, 'cancelled'))
    expect(error).toBeInstanceOf(APIError)
    expect((error as APIError).status).toBe(409)
    expect((error as Error).message).not.toMatch(/custom:/)

    expect((await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })).status).toBe('pending')
    expect(await qtyAt(payload, product, warehouse)).toBe(1)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(1)
  })

  it('закритий період блокує скасування', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)

    const order = await adminOrder(product, 1)
    await settings({ lockedUntil: new Date(Date.now() + 60_000).toISOString() })

    try {
      const error = await rejection(setStatus(order, 'cancelled'))
      expect(error).toBeInstanceOf(APIError)
      expect((error as APIError).status).toBe(409)
      expect((await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })).status).toBe('pending')
      expect(await qtyAt(payload, product, warehouse)).toBe(1)
    } finally {
      await settings({ lockedUntil: null })
    }
  })

  it('проведене замовлення не видаляється, непроведене видаляється', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)

    const posted = await adminOrder(product, 1)
    const error = await rejection(payload.delete({ collection: 'orders', id: posted.id, user: admin }))
    expect(error).toBeInstanceOf(APIError)
    expect((error as APIError).status).toBe(409)
    expect(await payload.findByID({ collection: 'orders', id: posted.id, depth: 0 })).toBeTruthy()

    // Скасоване проведене замовлення теж лишається в історії.
    await setStatus(posted, 'cancelled')
    expect(await rejection(payload.delete({ collection: 'orders', id: posted.id, user: admin }))).toBeInstanceOf(APIError)

    await settings({ stockControlEnabled: false })
    try {
      const unposted = await adminOrder(product, 1)
      await payload.delete({ collection: 'orders', id: unposted.id, user: admin })
      expect(await payload.count({ collection: 'orders', where: { id: { equals: unposted.id } } })).toEqual({ totalDocs: 0 })
    } finally {
      await settings({ stockControlEnabled: true })
    }
  })
})
