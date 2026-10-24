import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import {
  ORDER_COUNTER_ID,
  ORDER_COUNTERS_COLLECTION,
} from '@/collections/Orders/hooks/setOrderNumber'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'

let payload: Payload
let data: TestData

const counters = () => payload.db.connection.collection(ORDER_COUNTERS_COLLECTION)

/** Найбільший числовий номер серед замовлень у тестовій БД. */
const maxOrderNumber = async () => {
  const { docs } = await payload.find({
    collection: 'orders',
    select: { orderNumber: true },
    pagination: false,
    depth: 0,
  })
  return docs.reduce((max, doc) => {
    const value = doc.orderNumber ?? ''
    return /^\d+$/.test(value) ? Math.max(max, Number(value)) : max
  }, 0)
}

describe('orderNumber', () => {
  let orderBody: { items: Array<{ product: string; quantity: number }>; shippingAddress: typeof shippingAddress }

  const createOrder = async () => {
    const { status, body } = await callCreateOrder(payload, { body: orderBody })
    expect(status).toBe(201)
    return loadOrder(payload, data, body.order.id)
  }

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    vi.spyOn(payload.logger, 'warn').mockImplementation(() => {})

    const brand = await data.brand()
    const product = await data.product({ brand: brand.id, retailPrice: 100 })
    orderBody = { items: [{ product: product.id, quantity: 1 }], shippingAddress }
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('без лічильника продовжує нумерацію з найбільшого наявного номера', async () => {
    await counters().deleteOne({ _id: ORDER_COUNTER_ID as never })
    const max = await maxOrderNumber()

    const order = await createOrder()

    expect(order.orderNumber).toBe(String(max + 1))
  })

  it('номер — ціле число рядком, наступне замовлення отримує +1', async () => {
    const first = await createOrder()
    const second = await createOrder()

    expect(first.orderNumber).toMatch(/^\d+$/)
    expect(Number(second.orderNumber)).toBe(Number(first.orderNumber) + 1)
  })

  it('паралельні замовлення не падають на unique і отримують послідовні номери', async () => {
    const orders = await Promise.all(Array.from({ length: 5 }, () => createOrder()))

    const numbers = orders.map((order) => Number(order.orderNumber)).sort((a, b) => a - b)
    expect(new Set(numbers).size).toBe(5)
    expect(numbers[4] - numbers[0]).toBe(4)
  })
})
