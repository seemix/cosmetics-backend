import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { checkCashCache } from '@/endpoints/cashCacheCheck'
import type { CashOperation, Order } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import {
  cleanupStock,
  createAdmin,
  deleteDocumentsDirectly,
  inTransaction,
  stockUp,
  type AuthUser,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brand: string
let warehouse: string
let account: string
let previousSettings: Record<string, unknown>

const tag = `CBAL-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []
const customers: string[] = []
const operations: Array<number | string> = []
const openings: Array<number | string> = []
const fundingDoc = { collection: 'test-docs', id: 'customer-balance-funding' }

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const settings = (patch: Record<string, unknown>) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: patch as never })

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const newCustomer = async () => {
  const id = String((await data.user()).id)
  customers.push(id)
  return id
}

/** Замовлення клієнта на 1 шт. за `retailPrice`; проводиться (облік увімкнено). */
const newOrder = async (customer: string, retailPrice = 100): Promise<Order> => {
  const product = String((await data.product({ brand, retailPrice })).id)
  products.push(product)
  await stockUp(payload, product, warehouse, 5, 5000)

  const order = await payload.create({
    collection: 'orders',
    user: admin,
    data: { items: [{ product, quantity: 1, price: 0 }], total: 0, customer } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  return order
}

const paymentOf = async (order: Order) => {
  const doc = await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })
  return { paidBani: doc.paidBani, paymentState: doc.paymentState }
}

const advanceOf = async (customer: string) => {
  const { docs } = await payload.find({ collection: 'customer-balances', where: { customer: { equals: customer } }, depth: 0 })
  return docs[0]?.balanceBani ?? 0
}

const cashBalance = async () => (await payload.findByID({ collection: 'cash-accounts', id: account, depth: 0 })).balanceBani ?? 0

type PaymentType = Extract<CashOperation['type'], 'customer_receipt' | 'customer_refund'>

const draft = async (type: PaymentType, amountBani: number, target: { customer?: string; order?: Order }) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: {
      status: 'draft',
      operationDate: '2026-10-25T00:00:00.000Z',
      type,
      account,
      amountBani,
      ...(target.customer ? { customer: target.customer } : {}),
      ...(target.order ? { order: target.order.id } : {}),
    },
    ...asAdmin,
  })
  operations.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...asAdmin })

const pay = async (type: PaymentType, amountBani: number, target: { customer?: string; order?: Order }) =>
  post((await draft(type, amountBani, target)).id)

const reverse = (collection: 'cash-operations' | 'opening-balances', id: number | string) =>
  payload.update({ collection, id, data: { status: 'reversed', reversalReason: 'entered by mistake' }, ...asAdmin })

const movesOf = async (customer: string) =>
  (
    await payload.find({
      collection: 'customer-moves',
      where: { customer: { equals: customer } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs.map((move) => ({
    kind: move.kind,
    advance: move.advanceDeltaBani,
    order: move.order ? idOf(move.order) : null,
    paid: move.orderDeltaBani,
  }))

describe('Баланс клієнта: аванс і розподіл оплат (розд. 6.4)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)

    warehouse = String((await payload.create({ collection: 'warehouses', data: { name: `${tag} shop`, code: `${tag}-shop` } })).id)
    warehouses.push(warehouse)
    account = String(
      (await payload.create({ collection: 'cash-accounts', data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' } })).id,
    )
    // Запас у касі для повернень і сторно.
    await inTransaction(payload, (req) => applyCashMoves(req, { doc: fundingDoc, lines: [{ account, deltaBani: 1_000_000 }] }))

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
      lockedUntil: before.lockedUntil ?? null,
    }
    await settings({ stockControlEnabled: true, defaultAdminWarehouse: warehouse, lockedUntil: null })
  })

  afterAll(async () => {
    await settings({ stockControlEnabled: previousSettings.stockControlEnabled === true })
    await settings(previousSettings).catch(() => {})
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await deleteDocumentsDirectly(payload, 'opening-balances', openings)
    await payload.delete({ collection: 'customer-moves', where: { customer: { in: customers } } })
    await payload.delete({ collection: 'customer-balances', where: { customer: { in: customers } } })
    await payload.delete({ collection: 'cash-moves', where: { account: { equals: account } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { equals: account } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('надходження без замовлення гасить борги від найстарішого, решта лишається авансом', async () => {
    const customer = await newCustomer()
    const [older, newer] = [await newOrder(customer), await newOrder(customer)]

    const receipt = await pay('customer_receipt', 15000, { customer })

    expect(idOf(receipt.customer)).toBe(customer)
    expect(receipt.order ?? null).toBeNull()
    expect(await paymentOf(older)).toEqual({ paidBani: 10000, paymentState: 'paid' })
    expect(await paymentOf(newer)).toEqual({ paidBani: 5000, paymentState: 'partial' })
    expect(await advanceOf(customer)).toBe(0)

    await pay('customer_receipt', 8000, { customer })

    expect(await paymentOf(newer)).toEqual({ paidBani: 10000, paymentState: 'paid' })
    expect(await advanceOf(customer)).toBe(3000)
    expect(await movesOf(customer)).toEqual([
      { kind: 'receipt', advance: 15000, order: null, paid: 0 },
      { kind: 'allocation', advance: -10000, order: String(older.id), paid: 10000 },
      { kind: 'allocation', advance: -5000, order: String(newer.id), paid: 5000 },
      { kind: 'receipt', advance: 8000, order: null, paid: 0 },
      { kind: 'allocation', advance: -5000, order: String(newer.id), paid: 5000 },
    ])
  })

  it('вказане замовлення оплачується першим, решта йде на старіші борги', async () => {
    const customer = await newCustomer()
    const [older, chosen] = [await newOrder(customer), await newOrder(customer)]

    await pay('customer_receipt', 12000, { order: chosen })

    expect(await paymentOf(chosen)).toEqual({ paidBani: 10000, paymentState: 'paid' })
    expect(await paymentOf(older)).toEqual({ paidBani: 2000, paymentState: 'partial' })
    expect(await advanceOf(customer)).toBe(0)
  })

  it('аванс автоматично гасить нове замовлення', async () => {
    const customer = await newCustomer()
    await pay('customer_receipt', 15000, { customer })
    expect(await advanceOf(customer)).toBe(15000)

    const first = await newOrder(customer)
    expect(first).toMatchObject({ paidBani: 10000, paymentState: 'paid' })

    const second = await newOrder(customer)
    expect(second).toMatchObject({ paidBani: 5000, paymentState: 'partial' })
    expect(await advanceOf(customer)).toBe(0)
  })

  it('повернення без замовлення бере з авансу, понад аванс відхиляється', async () => {
    const customer = await newCustomer()
    await pay('customer_receipt', 5000, { customer })
    const cashBefore = await cashBalance()

    const tooMuch = await draft('customer_refund', 5001, { customer })
    await expect(post(tooMuch.id)).rejects.toThrow(/has an advance of 50\.00, requested 50\.01/)
    expect(await cashBalance()).toBe(cashBefore)

    await pay('customer_refund', 2000, { customer })
    expect(await advanceOf(customer)).toBe(3000)
    expect(await cashBalance()).toBe(cashBefore - 2000)
  })

  it('сторно надходження: спершу з авансу, решта знімається з найновіших замовлень', async () => {
    const customer = await newCustomer()
    const receipt = await pay('customer_receipt', 25000, { customer })
    const [older, newer] = [await newOrder(customer), await newOrder(customer)]
    await pay('customer_receipt', 10000, { customer })
    // 250,00 авансу оплатили обидва замовлення (200,00), разом з другим надходженням аванс 150,00.
    expect(await advanceOf(customer)).toBe(15000)

    await reverse('cash-operations', receipt.id)

    expect(await advanceOf(customer)).toBe(0)
    expect(await paymentOf(older)).toEqual({ paidBani: 10000, paymentState: 'paid' })
    expect(await paymentOf(newer)).toEqual({ paidBani: 0, paymentState: 'unpaid' })
  })

  it('сторно повернення без замовлення знову зараховує суму й гасить борг', async () => {
    const customer = await newCustomer()
    await pay('customer_receipt', 3000, { customer })
    const refund = await pay('customer_refund', 3000, { customer })
    const order = await newOrder(customer)

    await reverse('cash-operations', refund.id)

    expect(await paymentOf(order)).toEqual({ paidBani: 3000, paymentState: 'partial' })
    expect(await advanceOf(customer)).toBe(0)
  })

  it('скасування оплаченого замовлення повертає оплату на аванс і гасить інший борг', async () => {
    const customer = await newCustomer()
    const [paid, unpaid] = [await newOrder(customer), await newOrder(customer, 50)]
    await pay('customer_receipt', 10000, { order: paid })
    expect(await paymentOf(unpaid)).toEqual({ paidBani: 0, paymentState: 'unpaid' })

    await payload.update({ collection: 'orders', id: paid.id, user: admin, data: { status: 'cancelled' }, depth: 0 })

    expect(await paymentOf(paid)).toEqual({ paidBani: 0, paymentState: 'unpaid' })
    expect(await paymentOf(unpaid)).toEqual({ paidBani: 5000, paymentState: 'paid' })
    expect(await advanceOf(customer)).toBe(5000)
  })

  it('надходження без клієнта й без замовлення відхиляється', async () => {
    await expect(draft('customer_receipt', 100, {})).rejects.toThrow(/Select the customer or the order/)
  })

  describe('початкові аванси', () => {
    const newAdvance = async (lines: Array<{ customer: string; amountBani: number }>) => {
      const doc = await payload.create({
        collection: 'opening-balances',
        data: { kind: 'customerAdvance', status: 'draft', documentDate: '2026-10-20T00:00:00.000Z', advanceLines: lines },
        ...asAdmin,
      })
      openings.push(doc.id)
      return doc
    }

    it('проведення зараховує аванс і гасить борг; сторно знімає назад', async () => {
      const customer = await newCustomer()
      const order = await newOrder(customer)
      const doc = await newAdvance([{ customer, amountBani: 12000 }])

      await payload.update({ collection: 'opening-balances', id: doc.id, data: { status: 'posted' }, ...asAdmin })

      expect(await paymentOf(order)).toEqual({ paidBani: 10000, paymentState: 'paid' })
      expect(await advanceOf(customer)).toBe(2000)

      await reverse('opening-balances', doc.id)

      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid' })
      expect(await advanceOf(customer)).toBe(0)
    })

    it('дубль клієнта в документі відхиляється', async () => {
      const customer = await newCustomer()

      await expect(
        newAdvance([
          { customer, amountBani: 100 },
          { customer, amountBani: 200 },
        ]),
      ).rejects.toThrow(/customer can appear only once/)
    })
  })

  it('кеш авансів і оплат замовлень збігається з журналом', async () => {
    const discrepancies = await checkCashCache(await createLocalReq({}, payload))
    const mine = discrepancies.filter(
      (item) =>
        (item.type === 'customerAdvance' && customers.includes(item.id)) ||
        (item.type === 'orderPaid' && orders.includes(item.id)),
    )

    expect(mine).toEqual([])
  })
})
