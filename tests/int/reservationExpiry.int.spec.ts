import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reservationSummary, type ReservationSummary } from '@/endpoints/reservationSummary'
import config from '@/payload.config'
import { expiredBefore, expiryDate, isReservationExpired } from '@/services/orders/reservationExpiry'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import { cleanupStock, createAdmin, deleteDocumentsDirectly, stockUp, type AuthUser } from './helpers/stock'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-06-10T12:00:00.000Z')
const reserved = (daysAgo: number, extra: Record<string, unknown> = {}) => ({
  status: 'pending',
  accounting: { reservedItems: [{ qty: 1 }], reservedAt: new Date(now.getTime() - daysAgo * DAY) },
  ...extra,
})

describe('В23: строк резерву (сервіс)', () => {
  it('рівно N днів ще не прострочено, на мілісекунду більше вже так', () => {
    expect(isReservationExpired(reserved(3), 3, now)).toBe(false)
    expect(isReservationExpired(reserved(3 + 1 / DAY), 3, now)).toBe(true)
    expect(isReservationExpired(reserved(1), 3, now)).toBe(false)
  })

  it('порожнє, нульове чи нечислове налаштування означає «без контролю»', () => {
    for (const days of [null, undefined, 0, -1, NaN, '3']) {
      expect(isReservationExpired(reserved(100), days, now)).toBe(false)
      expect(expiredBefore(days, now)).toBeNull()
      expect(expiryDate(new Date(), days)).toBeNull()
    }
  })

  it('backorder без резерву, скасоване й відвантажене не прострочуються', () => {
    expect(isReservationExpired({ status: 'backorder', accounting: { reservedItems: [], reservedAt: null } }, 1, now)).toBe(false)
    expect(isReservationExpired(reserved(10, { status: 'cancelled' }), 1, now)).toBe(false)
    expect(isReservationExpired(reserved(10, { status: 'shipped' }), 1, now)).toBe(false)
    expect(isReservationExpired({ status: 'pending', accounting: { reservedItems: [{ qty: 1 }] } }, 1, now)).toBe(false)
  })

  it('paid із резервом прострочується, як pending', () => {
    expect(isReservationExpired(reserved(5, { status: 'paid' }), 3, now)).toBe(true)
  })

  it('expiryDate і expiredBefore рахують від reservedAt і від now', () => {
    expect(expiryDate('2026-06-01T00:00:00.000Z', 2)?.toISOString()).toBe('2026-06-03T00:00:00.000Z')
    expect(expiredBefore(2, now)?.toISOString()).toBe('2026-06-08T12:00:00.000Z')
  })
})

describe('В23: GET /orders/reservation-summary', () => {
  let payload: Payload
  let data: TestData
  let admin: AuthUser
  let warehouse: string
  let product: string
  let previousSettings: Record<string, unknown>

  const tag = `RSUM-${Date.now()}`
  const orders: string[] = []
  const products: string[] = []
  const warehouses: string[] = []

  const call = async (role?: 'admin' | 'manager' | 'customer') => {
    const req = await createLocalReq(
      { user: role ? ({ id: 'u', roles: [role], collection: 'users' } as never) : undefined },
      payload,
    )
    const response = await reservationSummary.handler(req)

    return { status: response.status, body: (await response.json()) as ReservationSummary }
  }

  const backdate = (id: string, daysAgo: number) =>
    payload.db.collections.orders.updateOne(
      { _id: id as never },
      { $set: { 'accounting.reservedAt': new Date(Date.now() - daysAgo * DAY) } },
    )

  const createOrder = async (extra: Record<string, unknown> = {}) => {
    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0, warehouse, ...extra } as never,
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

    const brand = String((await data.brand()).id)
    warehouse = String((await payload.create({ collection: 'warehouses', data: { name: tag, code: tag } })).id)
    warehouses.push(warehouse)
    product = String((await data.product({ brand, retailPrice: 100 })).id)
    products.push(product)
    await stockUp(payload, product, warehouse, 2, 2000)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      reservationDays: before.reservationDays ?? null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { stockControlEnabled: true, reservationDays: 3 } as never,
    })
  })

  afterAll(async () => {
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  it('права: гість 401, customer 403, manager і admin 200', async () => {
    expect((await call()).status).toBe(401)
    expect((await call('customer')).status).toBe(403)
    expect((await call('manager')).status).toBe(200)
    expect((await call('admin')).status).toBe(200)
  })

  it('рахує прострочені резерви й backorder, віддає найстаріші', async () => {
    const base = (await call('admin')).body

    const old = await createOrder()
    const fresh = await createOrder()
    await backdate(String(old.id), 5)
    await backdate(String(fresh.id), 1)

    const afterReserve = (await call('manager')).body
    expect(afterReserve.reservationDays).toBe(3)
    expect(afterReserve.expiredCount).toBe(base.expiredCount + 1)
    expect(afterReserve.oldestExpired.some((order) => order.id === String(old.id))).toBe(true)
    expect(afterReserve.oldestExpired.some((order) => order.id === String(fresh.id))).toBe(false)
    expect(afterReserve.oldestExpired.length).toBeLessThanOrEqual(10)

    // Резервів більше немає, залишок вичерпано: наступне замовлення стає backorder, а не прострочене.
    const backorder = await createOrder({ items: [{ product, quantity: 5, price: 0 }] })
    expect(backorder.status).toBe('backorder')

    const afterBackorder = (await call('admin')).body
    expect(afterBackorder.backorderCount).toBe(base.backorderCount + 1)
    expect(afterBackorder.expiredCount).toBe(afterReserve.expiredCount)
  })

  it('без reservationDays прострочених немає, а перепродаж рахується', async () => {
    await payload.updateGlobal({ slug: 'accounting-settings', data: { reservationDays: null } as never })
    const noControl = (await call('admin')).body
    expect(noControl.reservationDays).toBeNull()
    expect(noControl.expiredCount).toBe(0)
    expect(noControl.oldestExpired).toEqual([])

    const before = noControl.oversoldCount
    await payload.db.collections['stock-balances'].updateOne(
      { product: product as never, warehouse: warehouse as never },
      { $set: { reserved: 99 } },
    )
    expect((await call('admin')).body.oversoldCount).toBe(before + 1)
  })
})
