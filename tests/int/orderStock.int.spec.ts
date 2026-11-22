import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { InsufficientStockError } from '@/services/stock/errors'
import { issue } from '@/services/stock/stockLedger.service'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'
import {
  cleanupStock,
  costOf,
  createAdmin,
  deleteDocumentsDirectly,
  inTransaction,
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

/** Зарезервовано в кеші залишків (В23). */
const reservedAt = async (product: string, warehouse: string) =>
  (
    await payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouse } },
      depth: 0,
    })
  ).docs[0]?.reserved ?? 0

/** Виклики `payload.create` саме для замовлень (рухи журналу теж ідуть через `create`). */
const orderCreates = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([args]) => (args as { collection?: string }).collection === 'orders').length

/** Відвантаження в адмінці: саме воно проводить замовлення (В20). */
const ship = (id: string | number) =>
  payload.update({ collection: 'orders', id, user: admin, data: { status: 'shipped' } as never, depth: 0 })

const createWeb = async (items: Array<{ product: string; quantity: number }>) => {
  const response = await callCreateOrder(payload, { body: { items, shippingAddress } })
  if (response.status === 201) orders.push(String(response.body.order.id))
  return response
}

describe('S2.3/S2.4, В20: списання при відвантаженні замовлення', () => {
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
    // Проведені замовлення хук видалення не дає прибрати.
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('облік вимкнено: замовлення не в обліку, відвантаження не списує й не пише рухів', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 5, 50000)
    await setStockControl(false)

    try {
      const { status, body } = await createWeb([{ product, quantity: 2 }])
      expect(status).toBe(201)

      const created = await loadOrder(payload, data, body.order.id)
      expect(created.accounting?.stockTracked).toBe(false)
      await ship(created.id)

      const order = await loadOrder(payload, data, created.id)
      expect(order.status).toBe('shipped')
      expect(order.accounting?.stockPostedAt ?? null).toBeNull()
      expect(order.accounting?.cogsBani ?? null).toBeNull()
      expect(await qtyAt(payload, product, webWarehouse)).toBe(5)
      expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
    } finally {
      await setStockControl(true)
    }
  })

  it('замовлення сайту створюється без списання, відвантаження списує зі складу сайту: собівартість, stockPostedAt, рухи', async () => {
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

    const pending = await loadOrder(payload, data, body.order.id)
    expect(pending.status).toBe('pending')
    expect(pending.accounting?.stockTracked).toBe(true)
    expect(pending.accounting?.stockPostedAt ?? null).toBeNull()
    expect(await qtyAt(payload, a, webWarehouse)).toBe(14)
    expect(await movesOfDoc(payload, 'orders', pending.id)).toHaveLength(0)

    await ship(pending.id)
    const order = await loadOrder(payload, data, pending.id)
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

  it('нестача при створенні на сайті: 409 з деталями, замовлення немає, кеш незмінний, сповіщень немає', async () => {
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
      items: [{ product: scarce, requested: 2 }], // гість: кількість у відповіді не показуємо (В4)
    })
    expect(await ordersWith(enough)).toBe(0)
    expect(await qtyAt(payload, enough, webWarehouse)).toBe(5)
    expect(await costOf(payload, enough)).toEqual({ qty: 5, valueBani: 5000 })
    expect(await qtyAt(payload, scarce, webWarehouse)).toBe(1)
    expect(payload.sendEmail).not.toHaveBeenCalled()
  })

  it('нестача при відвантаженні (перепродаж після інвентаризації): помилка з назвами мовою адмінки, замовлення лишається pending з резервом', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 2, 2000)

    const { status, body } = await createWeb([{ product, quantity: 2 }])
    expect(status).toBe(201)
    // Списання з інвентаризації дозволене нижче резерву (В23): reserved 2 > qty 1.
    await inTransaction(payload, (req) =>
      issue(req, {
        doc: { collection: 'test-docs', id: 'oversell' },
        moveType: 'inventory',
        lines: [{ product, warehouse: webWarehouse, qty: 1 }],
        allowBelowReserved: true,
      }),
    )

    const error = await ship(body.order.id).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(InsufficientStockError)
    expect((error as Error).message).toMatch(new RegExp(`${tag} web.*2.*1`))

    const order = await loadOrder(payload, data, body.order.id)
    expect(order.status).toBe('pending')
    expect(order.accounting?.stockPostedAt ?? null).toBeNull()
    expect(await qtyAt(payload, product, webWarehouse)).toBe(1)
    expect(await reservedAt(product, webWarehouse)).toBe(2)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
  })

  it('з адмінки pending не списує; одразу відвантажене (Local API з admin) списує зі складу замовлення', async () => {
    const product = await newProduct(100)
    await stockUp(payload, product, adminWarehouse, 3, 3000)

    const pending = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0 } as never,
      depth: 0,
    })
    orders.push(String(pending.id))
    expect(pending.accounting?.stockPostedAt ?? null).toBeNull()
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(3)

    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 2, price: 0 }], total: 0, status: 'shipped' } as never,
      depth: 0,
    })
    orders.push(String(order.id))

    expect(idOf(order.warehouse)).toBe(adminWarehouse)
    expect(order.accounting?.stockPostedAt).toBeTruthy()
    expect(order.accounting?.cogsBani).toBe(2000)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(1)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(1)
  })

  it('з адмінки нестача відхиляє збереження відвантаженого з текстом мовою адмінки', async () => {
    const product = await newProduct()
    await stockUp(payload, product, adminWarehouse, 1, 1000)

    const error = await payload
      .create({
        collection: 'orders',
        user: admin,
        data: { items: [{ product, quantity: 2, price: 0 }], total: 0, status: 'shipped' } as never,
        depth: 0,
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(InsufficientStockError)
    expect((error as Error).message).toMatch(new RegExp(`${tag} admin.*2.*1`))
    expect(await ordersWith(product)).toBe(0)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(1)
  })

  it('значення accounting з тіла запиту не проводять замовлення й не змінюють ознаку обліку', async () => {
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
          accounting: { stockPostedAt: new Date().toISOString(), cogsBani: 999, stockTracked: true },
        } as never,
        depth: 0,
      })
      orders.push(String(order.id))

      expect(order.accounting?.stockPostedAt ?? null).toBeNull()
      expect(order.accounting?.cogsBani ?? null).toBeNull()
      expect(order.accounting?.stockTracked).toBe(false)
      expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(0)
    } finally {
      await setStockControl(true)
    }

    const tracked = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0 } as never,
      depth: 0,
    })
    orders.push(String(tracked.id))

    const updated = await payload.update({
      collection: 'orders',
      id: tracked.id,
      user: admin,
      data: { accounting: { stockPostedAt: new Date().toISOString(), cogsBani: 999, stockTracked: false } } as never,
      depth: 0,
    })
    expect(updated.accounting?.stockPostedAt ?? null).toBeNull()
    expect(updated.accounting?.cogsBani ?? null).toBeNull()
    expect(updated.accounting?.stockTracked).toBe(true)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(2)
  })

  it('два замовлення сайту на весь залишок: перше резервує, друге отримує 409 (В23)', async () => {
    const product = await newProduct()
    await stockUp(payload, product, webWarehouse, 2, 2000)

    const responses = await Promise.all([
      createWeb([{ product, quantity: 2 }]),
      createWeb([{ product, quantity: 2 }]),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(await ordersWith(product)).toBe(1)
    expect(await qtyAt(payload, product, webWarehouse)).toBe(2)
    expect(await reservedAt(product, webWarehouse)).toBe(2)

    const created = responses.find((response) => response.status === 201)!
    const pending = await loadOrder(payload, data, created.body.order.id)
    expect(pending.status).toBe('pending')
    expect(pending.accounting?.reservedItems?.map((row) => ({ product: idOf(row.product), warehouse: idOf(row.warehouse), qty: row.qty }))).toEqual([
      { product, warehouse: webWarehouse, qty: 2 },
    ])
    expect(pending.accounting?.reservedAt).toBeTruthy()

    await ship(pending.id)
    const shipped = await loadOrder(payload, data, pending.id)
    expect(shipped.accounting?.reservedItems ?? []).toEqual([])
    expect(await qtyAt(payload, product, webWarehouse)).toBe(0)
    expect(await reservedAt(product, webWarehouse)).toBe(0)
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

      create.mockClear()
      create.mockRejectedValueOnce(new Error('boom'))
      const failed = await createWeb([{ product, quantity: 1 }])
      expect(failed.status).toBe(500)
      expect(orderCreates(create)).toBe(1)
      expect(await ordersWith(product)).toBe(1)
    } finally {
      create.mockRestore()
    }
  })
})

describe('В20: замовлення до відвантаження', () => {
  // Окремий набір з тим самим оточенням: склад і облік налаштовує попередній describe лише на свій час.
  let product: string
  let customer: string

  const createAdminOrder = async (extra: Record<string, unknown> = {}) => {
    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0, ...extra } as never,
      depth: 0,
    })
    orders.push(String(order.id))
    return order
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)
    const doc = await payload.create({ collection: 'warehouses', data: { name: `${tag} edit`, code: `${tag}-edit` } })
    warehouses.push(String(doc.id))
    adminWarehouse = String(doc.id)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { stockControlEnabled: true, defaultAdminWarehouse: adminWarehouse } as never,
    })

    product = await newProduct(100)
    await stockUp(payload, product, adminWarehouse, 10, 10000)
    customer = String((await data.user()).id)
  })

  afterAll(async () => {
    await setStockControl(previousSettings.stockControlEnabled === true)
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('позиції, знижку й клієнта можна змінити: ціни, сума й виручка перераховуються', async () => {
    const other = await newProduct(250)
    // Нові позиції резервуються (В23): товар має бути на складі.
    await stockUp(payload, other, adminWarehouse, 1, 1000)
    const order = await createAdminOrder()
    expect(order.total).toBe(100)

    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      user: admin,
      data: {
        items: [
          { product, quantity: 2, price: 0 },
          { product: other, quantity: 1, price: 0 },
        ],
        discount: 50,
        customer,
      } as never,
      depth: 0,
    })

    expect(updated.items?.map((item) => item.price)).toEqual([100, 250])
    expect(updated.total).toBe(400)
    expect(updated.accounting?.revenueBani).toBe(40000)
    expect(idOf(updated.customer)).toBe(customer)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(10)
  })

  it('непроведене замовлення видаляється, проведене ні', async () => {
    const pending = await createAdminOrder()
    await payload.delete({ collection: 'orders', id: pending.id, user: admin })
    expect(await payload.count({ collection: 'orders', where: { id: { equals: pending.id } } })).toEqual({ totalDocs: 0 })

    const shipped = await createAdminOrder({ status: 'shipped' })
    const error = await payload.delete({ collection: 'orders', id: shipped.id, user: admin }).catch((reason: unknown) => reason)
    expect((error as Error).message).toMatch(/cannot be deleted/)
  })

  it('відвантажене не редагується й не повертається в pending; скасування можливе', async () => {
    const order = await createAdminOrder({ status: 'shipped' })

    const edit = await payload
      .update({ collection: 'orders', id: order.id, user: admin, data: { items: [{ product, quantity: 3, price: 0 }] } as never })
      .catch((reason: unknown) => reason)
    expect((edit as Error).message).toMatch(/posted order cannot be edited/)

    const back = await payload
      .update({ collection: 'orders', id: order.id, user: admin, data: { status: 'pending' } as never })
      .catch((reason: unknown) => reason)
    expect((back as Error).message).toMatch(/can only be cancelled/)

    const cancelled = await payload.update({ collection: 'orders', id: order.id, user: admin, data: { status: 'cancelled' } as never, depth: 0 })
    expect(cancelled.status).toBe('cancelled')
  })

  it('склад за замовчуванням з налаштувань; до відвантаження його можна змінити, відвантаження списує з нового (В22)', async () => {
    const doc = await payload.create({ collection: 'warehouses', data: { name: `${tag} second`, code: `${tag}-second` } })
    warehouses.push(String(doc.id))
    const second = String(doc.id)
    await stockUp(payload, product, second, 5, 5000)

    const order = await createAdminOrder()
    expect(idOf(order.warehouse)).toBe(adminWarehouse)

    const moved = await payload.update({ collection: 'orders', id: order.id, user: admin, data: { warehouse: second } as never, depth: 0 })
    expect(idOf(moved.warehouse)).toBe(second)

    const before = await qtyAt(payload, product, adminWarehouse)
    await payload.update({ collection: 'orders', id: order.id, user: admin, data: { status: 'shipped' } as never, depth: 0 })
    expect(await qtyAt(payload, product, second)).toBe(4)
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(before)

    const error = await payload
      .update({ collection: 'orders', id: order.id, user: admin, data: { warehouse: adminWarehouse } as never })
      .catch((reason: unknown) => reason)
    expect((error as Error).message).toMatch(/posted order cannot be edited/)
  })

  it('зміна позицій і відвантаження в одному збереженні списує нові позиції', async () => {
    const order = await createAdminOrder()
    const before = await qtyAt(payload, product, adminWarehouse)

    const shipped = await payload.update({
      collection: 'orders',
      id: order.id,
      user: admin,
      data: { items: [{ product, quantity: 3, price: 0 }], status: 'shipped' } as never,
      depth: 0,
    })

    expect(shipped.total).toBe(300)
    expect(shipped.accounting?.revenueBani).toBe(30000)
    expect(shipped.accounting?.stockPostedAt).toBeTruthy()
    expect(await qtyAt(payload, product, adminWarehouse)).toBe(before - 3)
  })
})

describe('В23: резерв замовлень до відвантаження', () => {
  let warehouse: string
  let second: string

  const rows = (value: unknown) =>
    (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []).map(({ id: _id, ...row }) => ({
      ...row,
      product: idOf(row.product),
      warehouse: idOf(row.warehouse),
    }))

  const createAdminOrder = async (
    items: Array<{ product: string; quantity: number }>,
    extra: Record<string, unknown> = {},
  ) => {
    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: items.map((item) => ({ ...item, price: 0 })), total: 0, ...extra } as never,
      depth: 0,
    })
    orders.push(String(order.id))
    return order
  }

  const update = (id: string | number, patch: Record<string, unknown>) =>
    payload.update({ collection: 'orders', id, user: admin, data: patch as never, depth: 0 })

  const rejected = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (reason: unknown) => reason as Error & { status?: number },
    )

  const byProduct = <T extends { product: string }>(list: T[]) =>
    [...list].sort((a, b) => a.product.localeCompare(b.product))

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)
    for (const code of ['res', 'res2']) {
      const doc = await payload.create({ collection: 'warehouses', data: { name: `${tag} ${code}`, code: `${tag}-${code}` } })
      warehouses.push(String(doc.id))
    }
    ;[warehouse, second] = warehouses.slice(-2)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { stockControlEnabled: true, defaultAdminWarehouse: warehouse } as never,
    })
  })

  afterAll(async () => {
    await setStockControl(previousSettings.stockControlEnabled === true)
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('з адмінки при нестачі стає backorder з повним переліком нестач і без резерву', async () => {
    const enough = await newProduct()
    const scarce = await newProduct()
    const missing = await newProduct()
    await stockUp(payload, enough, warehouse, 5, 5000)
    await stockUp(payload, scarce, warehouse, 1, 1000)

    const order = await createAdminOrder([
      { product: enough, quantity: 2 },
      { product: scarce, quantity: 3 },
      { product: missing, quantity: 1 },
    ])

    expect(order.status).toBe('backorder')
    expect(rows(order.accounting?.reservedItems)).toEqual([])
    expect(order.accounting?.reservedAt ?? null).toBeNull()
    expect(byProduct(rows(order.accounting?.shortages))).toEqual(
      byProduct([
        { product: scarce, warehouse, requested: 3, available: 1 },
        { product: missing, warehouse, requested: 1, available: 0 },
      ]),
    )
    expect(await reservedAt(enough, warehouse)).toBe(0)
    expect(await reservedAt(scarce, warehouse)).toBe(0)
  })

  it('створення одразу в backorder рахує нестачі без резерву', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 1, 1000)

    const order = await createAdminOrder([{ product, quantity: 2 }], { status: 'backorder' })
    expect(order.status).toBe('backorder')
    expect(rows(order.accounting?.shortages)).toEqual([{ product, warehouse, requested: 2, available: 1 }])
    expect(await reservedAt(product, warehouse)).toBe(0)
  })

  it('backorder → pending: при нестачі 409 з переліком і без змін, після приходу резервує все', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 1, 1000)
    const order = await createAdminOrder([{ product, quantity: 3 }])
    expect(order.status).toBe('backorder')

    const error = await rejected(update(order.id, { status: 'pending' }))
    expect(error).toBeInstanceOf(InsufficientStockError)
    expect(error?.status).toBe(409)
    expect(error?.message).toMatch(new RegExp(`${tag} res.*3.*1`))
    const still = await loadOrder(payload, data, order.id)
    expect(still.status).toBe('backorder')
    expect(rows(still.accounting?.shortages)).toEqual([{ product, warehouse, requested: 3, available: 1 }])
    expect(await reservedAt(product, warehouse)).toBe(0)

    await stockUp(payload, product, warehouse, 2, 2000)
    const pending = await update(order.id, { status: 'pending' })
    expect(pending.status).toBe('pending')
    expect(rows(pending.accounting?.reservedItems)).toEqual([{ product, warehouse, qty: 3 }])
    expect(pending.accounting?.reservedAt).toBeTruthy()
    expect(rows(pending.accounting?.shortages)).toEqual([])
    expect(await reservedAt(product, warehouse)).toBe(3)
    expect(await qtyAt(payload, product, warehouse)).toBe(3)
  })

  it('pending → backorder знімає резерв і перераховує нестачі', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)
    const order = await createAdminOrder([{ product, quantity: 2 }])
    expect(order.status).toBe('pending')
    expect(await reservedAt(product, warehouse)).toBe(2)

    const backorder = await update(order.id, { status: 'backorder' })
    expect(rows(backorder.accounting?.reservedItems)).toEqual([])
    expect(backorder.accounting?.reservedAt ?? null).toBeNull()
    expect(rows(backorder.accounting?.shortages)).toEqual([])
    expect(await reservedAt(product, warehouse)).toBe(0)

    // Зміна позицій backorder перераховує нестачі, резерву немає.
    const bigger = await update(order.id, { items: [{ product, quantity: 5, price: 0 }] })
    expect(rows(bigger.accounting?.shortages)).toEqual([{ product, warehouse, requested: 5, available: 2 }])
    expect(await reservedAt(product, warehouse)).toBe(0)
  })

  it('зміна кількості й складу переносить резерв, нестача відкочує зміну', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 4, 4000)
    await stockUp(payload, product, second, 2, 2000)
    const order = await createAdminOrder([{ product, quantity: 1 }])
    const reservedAtBefore = order.accounting?.reservedAt

    const more = await update(order.id, { items: [{ product, quantity: 3, price: 0 }] })
    expect(rows(more.accounting?.reservedItems)).toEqual([{ product, warehouse, qty: 3 }])
    expect(new Date(more.accounting!.reservedAt!).toISOString()).toBe(new Date(reservedAtBefore!).toISOString())
    expect(await reservedAt(product, warehouse)).toBe(3)

    const moved = await update(order.id, { warehouse: second, items: [{ product, quantity: 2, price: 0 }] })
    expect(rows(moved.accounting?.reservedItems)).toEqual([{ product, warehouse: second, qty: 2 }])
    expect(await reservedAt(product, warehouse)).toBe(0)
    expect(await reservedAt(product, second)).toBe(2)

    const error = await rejected(update(order.id, { items: [{ product, quantity: 3, price: 0 }] }))
    expect(error).toBeInstanceOf(InsufficientStockError)
    expect(error?.message).toMatch(new RegExp(`${tag} res2.*3.*2`))
    const unchanged = await loadOrder(payload, data, order.id)
    expect(unchanged.status).toBe('pending')
    expect(unchanged.items?.[0]?.quantity).toBe(2)
    expect(rows(unchanged.accounting?.reservedItems)).toEqual([{ product, warehouse: second, qty: 2 }])
    expect(await reservedAt(product, second)).toBe(2)
  })

  it('відвантаження знімає резерв і списує; чуже замовлення зарезервоване не відвантажує', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 3, 3000)
    const order = await createAdminOrder([{ product, quantity: 2 }])
    expect(await reservedAt(product, warehouse)).toBe(2)

    const other = await rejected(createAdminOrder([{ product, quantity: 2 }], { status: 'shipped' }))
    expect(other).toBeInstanceOf(InsufficientStockError)
    expect(await qtyAt(payload, product, warehouse)).toBe(3)

    const shipped = await ship(order.id)
    expect(shipped.accounting?.stockPostedAt).toBeTruthy()
    expect(rows(shipped.accounting?.reservedItems)).toEqual([])
    expect(await qtyAt(payload, product, warehouse)).toBe(1)
    expect(await reservedAt(product, warehouse)).toBe(0)
    expect(await movesOfDoc(payload, 'orders', order.id)).toHaveLength(1)
  })

  it('backorder → shipped відхилено', async () => {
    const product = await newProduct()
    const order = await createAdminOrder([{ product, quantity: 1 }])
    expect(order.status).toBe('backorder')

    const error = await rejected(ship(order.id))
    expect(error?.status).toBe(409)
    expect(error?.message).toMatch(/backorder cannot be shipped/i)
    expect((await loadOrder(payload, data, order.id)).status).toBe('backorder')
  })

  it('облік вимкнено: відвантаження все одно знімає знімок резерву, не списуючи', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouse, 2, 2000)
    const order = await createAdminOrder([{ product, quantity: 1 }])
    expect(await reservedAt(product, warehouse)).toBe(1)

    await setStockControl(false)
    try {
      const shipped = await ship(order.id)
      expect(rows(shipped.accounting?.reservedItems)).toEqual([])
      expect(shipped.accounting?.stockPostedAt ?? null).toBeNull()
      expect(await reservedAt(product, warehouse)).toBe(0)
      expect(await qtyAt(payload, product, warehouse)).toBe(2)
    } finally {
      await setStockControl(true)
    }
  })
})
