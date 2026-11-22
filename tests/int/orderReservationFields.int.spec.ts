import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import { createAdmin, type AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let productId: string
let warehouseId: string
const orders: string[] = []

const forged = (product: string, warehouse: string) => ({
  reservedItems: [{ product, warehouse, qty: 5 }],
  reservedAt: new Date().toISOString(),
  shortages: [{ product, warehouse, requested: 9, available: 1 }],
})

describe('R3 (В23): поля резерву замовлення тільки для системи', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    productId = String((await data.product({ brand: String((await data.brand()).id), retailPrice: 10 })).id)
    warehouseId = String(
      (await payload.create({ collection: 'warehouses', data: { name: `R3-${Date.now()}`, code: `R3-${Date.now()}` } })).id,
    )
  })

  afterAll(async () => {
    for (const id of orders) await payload.delete({ collection: 'orders', id }).catch(() => {})
    await payload.delete({ collection: 'warehouses', id: warehouseId }).catch(() => {})
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('create ігнорує reservedItems, reservedAt і shortages з тіла запиту', async () => {
    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: {
        items: [{ product: productId, quantity: 1, price: 0 }],
        total: 0,
        accounting: forged(productId, warehouseId),
      } as never,
      depth: 0,
    })
    orders.push(String(order.id))

    expect(order.accounting?.reservedItems ?? []).toEqual([])
    expect(order.accounting?.shortages ?? []).toEqual([])
    expect(order.accounting?.reservedAt ?? null).toBeNull()
  })

  it('update ігнорує ті самі поля й лишає наявний знімок', async () => {
    const order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product: productId, quantity: 1, price: 0 }], total: 0 } as never,
      depth: 0,
    })
    orders.push(String(order.id))

    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      user: admin,
      data: { accounting: forged(productId, warehouseId) } as never,
      depth: 0,
    })

    expect(updated.accounting?.reservedItems ?? []).toEqual([])
    expect(updated.accounting?.shortages ?? []).toEqual([])
    expect(updated.accounting?.reservedAt ?? null).toBeNull()
  })

  it('reservationDays: ціле від 1, порожнє дозволене', async () => {
    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    try {
      await expect(
        payload.updateGlobal({ slug: 'accounting-settings', data: { reservationDays: 0 } as never }),
      ).rejects.toThrow()
      await expect(
        payload.updateGlobal({ slug: 'accounting-settings', data: { reservationDays: 1.5 } as never }),
      ).rejects.toThrow()
      const ok = await payload.updateGlobal({ slug: 'accounting-settings', data: { reservationDays: 3 } as never })
      expect((ok as { reservationDays?: number }).reservationDays).toBe(3)
      const empty = await payload.updateGlobal({ slug: 'accounting-settings', data: { reservationDays: null } as never })
      expect((empty as { reservationDays?: number | null }).reservationDays ?? null).toBeNull()
    } finally {
      await payload.updateGlobal({
        slug: 'accounting-settings',
        data: { reservationDays: (before as { reservationDays?: number | null }).reservationDays ?? null } as never,
      })
    }
  })
})
