import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import type { Order } from '@/payload-types'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'

let payload: Payload
let data: TestData

/** Замовлення з двох одиниць товару за 1000 і знижкою промокоду 200 (total 1800). */
async function postedOrder() {
  const brand = await data.brand()
  const product = await data.product({ brand: brand.id, retailPrice: 1000 })
  const promo = await data.promo({ brands: [brand.id], percent: 10 })

  const { status, body } = await callCreateOrder(payload, {
    body: { items: [{ product: product.id, quantity: 2 }], shippingAddress, promoCode: promo.code },
  })
  expect(status).toBe(201)

  const order = await loadOrder(payload, data, body.order.id)
  expect(order.total).toBe(1800)
  expect(order.discount).toBe(200)
  return { order, product }
}

describe('S2.1: проведене замовлення заморожене', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('зміна ціни в каталогі не змінює суму при зміні статусу', async () => {
    const { order, product } = await postedOrder()

    await payload.update({ collection: 'products', id: product.id, data: { retailPrice: 1500 } })
    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      data: { status: 'paid' },
      depth: 0,
    })

    expect(updated.status).toBe('paid')
    expect(updated.total).toBe(1800)
    expect(updated.discount).toBe(200)
    expect(updated.items?.[0]?.price).toBe(1000)
  })

  it('повне збереження документа без змін сум проходить (як форма адмінки)', async () => {
    const { order, product } = await postedOrder()
    await payload.update({ collection: 'products', id: product.id, data: { retailPrice: 1500 } })

    const full = await payload.findByID({ collection: 'orders', id: order.id, depth: 1 })
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = full
    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      data: { ...rest, status: 'shipped' },
      depth: 0,
    })

    expect(updated.status).toBe('shipped')
    expect(updated.total).toBe(1800)
    expect(updated.items?.[0]?.price).toBe(1000)
  })

  it.each([
    ['items: кількість', (o: Order) => ({ items: [{ ...o.items![0], quantity: 3 }] })],
    ['items: ціна', (o: Order) => ({ items: [{ ...o.items![0], price: 1 }] })],
    ['items: новий рядок', (o: Order) => ({ items: [...o.items!, { ...o.items![0], id: undefined }] })],
    ['total', (_o: Order) => ({ total: 1 })],
    ['discount', (_o: Order) => ({ discount: 0 })],
  ])('зміна %s відхиляється', async (_name, patch) => {
    const { order } = await postedOrder()

    await expect(
      payload.update({ collection: 'orders', id: order.id, data: { status: 'paid', ...patch(order) } }),
    ).rejects.toThrow(/cannot be edited|нельзя|nu poate/i)

    const after = await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })
    expect(after.status).toBe('pending')
    expect(after.total).toBe(1800)
  })

  it('зміна клієнта відхиляється', async () => {
    const { order } = await postedOrder()
    const user = await data.user()

    await expect(
      payload.update({ collection: 'orders', id: order.id, data: { customer: user.id } }),
    ).rejects.toThrow(/cannot be edited|нельзя|nu poate/i)

    const after = await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })
    expect(after.customer ?? null).toBeNull()
  })
})
