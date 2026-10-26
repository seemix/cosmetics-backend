import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import type { CashOperation, Order } from '@/payload-types'
import { getCustomerDebts, getCustomerDebtTotals } from '@/services/finance/debts.service'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import { type AuthUser, cleanupStock, createAdmin, deleteDocumentsDirectly, stockUp } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let customer: string
let brand: string
let warehouse: string
let account: string
let previousSettings: Record<string, unknown>

const tag = `CDBT-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []
const openings: Array<number | string> = []
const operations: Array<number | string> = []
const customers: string[] = []
const telegramEnv = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID }

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

/**
 * Замовлення з адмінки на 1 шт.; `historical` = створене до вмикання обліку складу (без stockPostedAt).
 * Без `owner` у кожного замовлення свій клієнт: гроші клієнта гасять усі його борги (розд. 6.4).
 */
const newOrder = async ({
  historical = false,
  guest = false,
  retailPrice = 100,
  owner,
}: { historical?: boolean; guest?: boolean; retailPrice?: number; owner?: string } = {}): Promise<Order> => {
  const product = String((await data.product({ brand, retailPrice })).id)
  products.push(product)
  await stockUp(payload, product, warehouse, 5, 5000)
  const buyer = guest ? null : (owner ?? (await newCustomer()))

  await settings({ stockControlEnabled: !historical })
  const order = await payload
    .create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0, ...(buyer ? { customer: buyer } : {}) } as never,
      depth: 0,
    })
    .finally(() => settings({ stockControlEnabled: true }))
  orders.push(String(order.id))
  return order
}

const orderOf = (order: Order) => payload.findByID({ collection: 'orders', id: order.id, depth: 0 })

const paymentOf = async (order: Order) => {
  const doc = await orderOf(order)
  return { paidBani: doc.paidBani, paymentState: doc.paymentState }
}

const setStatus = (order: Order, status: Order['status']) =>
  payload.update({ collection: 'orders', id: order.id, user: admin, data: { status }, depth: 0 })

const draftReceipt = async (order: Order, amountBani: number) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: {
      status: 'draft',
      operationDate: '2026-10-25T00:00:00.000Z',
      type: 'customer_receipt',
      account,
      amountBani,
      order: order.id,
    } as Partial<CashOperation> as never,
    ...asAdmin,
  })
  operations.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...asAdmin })

const receive = async (order: Order, amountBani: number) => post((await draftReceipt(order, amountBani)).id)

const newDebt = async (lines: Array<{ order: string; amountBani: number }>) => {
  const doc = await payload.create({
    collection: 'opening-balances',
    data: { kind: 'customerDebt', status: 'draft', documentDate: '2026-10-20T00:00:00.000Z', customerLines: lines },
    ...asAdmin,
  })
  openings.push(doc.id)
  return doc
}

const postDebt = (id: number | string) =>
  payload.update({ collection: 'opening-balances', id, data: { status: 'posted' }, ...asAdmin })

const reverseDebt = (id: number | string) =>
  payload.update({
    collection: 'opening-balances',
    id,
    data: { status: 'reversed', reversalReason: 'wrong debt' },
    ...asAdmin,
  })

/** Створює й проводить customerDebt на одне замовлення. */
const debtOn = async (order: Order, amountBani: number) => postDebt((await newDebt([{ order: order.id, amountBani }])).id)

const debtsOf = async (filters: { customer?: string } = {}) =>
  getCustomerDebts(await createLocalReq({}, payload), filters)

const debtOfOrder = async (order: Order) => (await debtsOf()).find((debt) => debt.orderId === String(order.id))

const advanceOf = async (order: Order) => {
  const { docs } = await payload.find({
    collection: 'customer-balances',
    where: { customer: { equals: idOf(order.customer) } },
    depth: 0,
  })
  return docs[0]?.balanceBani ?? 0
}

describe('C5: борги покупців', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    customer = String((await data.user()).id)
    brand = String((await data.brand()).id)

    warehouse = String(
      (await payload.create({ collection: 'warehouses', data: { name: `${tag} shop`, code: `${tag}-shop` } })).id,
    )
    warehouses.push(warehouse)
    account = String(
      (
        await payload.create({
          collection: 'cash-accounts',
          data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' },
        })
      ).id,
    )

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
      lockedUntil: before.lockedUntil ?? null,
    }
    await settings({ stockControlEnabled: true, defaultAdminWarehouse: warehouse, lockedUntil: null })
  })

  afterAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = telegramEnv.token
    process.env.TELEGRAM_CHAT_ID = telegramEnv.chat
    await settings({ stockControlEnabled: previousSettings.stockControlEnabled === true })
    await settings(previousSettings).catch(() => {})
    await deleteDocumentsDirectly(payload, 'opening-balances', openings)
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'cash-moves', where: { account: { equals: account } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { equals: account } } })
    await payload.delete({ collection: 'customer-moves', where: { order: { in: orders } } })
    await payload.delete({ collection: 'customer-moves', where: { customer: { in: [customer, ...customers] } } })
    await payload.delete({ collection: 'customer-balances', where: { customer: { in: [customer, ...customers] } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  describe('список боргів', () => {
    it('звичайне замовлення: unpaid → борг = виручка, partial → залишок, paid → не в списку', async () => {
      const order = await newOrder()
      expect(await debtOfOrder(order)).toMatchObject({
        number: order.orderNumber,
        customer: idOf(order.customer),
        capBani: 10000,
        paidBani: 0,
        debtBani: 10000,
      })

      await receive(order, 4000)
      expect(await debtOfOrder(order)).toMatchObject({ capBani: 10000, paidBani: 4000, debtBani: 6000 })

      await receive(order, 6000)
      expect(await debtOfOrder(order)).toBeUndefined()
    })

    it('скасоване замовлення не в списку', async () => {
      const order = await newOrder()
      expect(await debtOfOrder(order)).toBeDefined()

      await setStatus(order, 'cancelled')

      expect(await debtOfOrder(order)).toBeUndefined()
    })

    it('історичне замовлення без customerDebt не в списку; оплата відхиляється', async () => {
      const order = await newOrder({ historical: true })

      expect(await debtOfOrder(order)).toBeUndefined()

      const doc = await draftReceipt(order, 100)
      await expect(post(doc.id)).rejects.toThrow(/has not deducted stock/)
      expect((await paymentOf(order)).paidBani).toBe(0)
    })

    it('історичне з customerDebt 500,00 і оплатою 200,00 → борг 300,00; понад ліміт іде в аванс; після повної оплати paid', async () => {
      const order = await newOrder({ historical: true, retailPrice: 1000 })
      await debtOn(order, 50000)
      expect(await debtOfOrder(order)).toMatchObject({ capBani: 50000, paidBani: 0, debtBani: 50000 })

      await receive(order, 20000)
      expect(await debtOfOrder(order)).toMatchObject({ capBani: 50000, paidBani: 20000, debtBani: 30000 })
      expect(await paymentOf(order)).toEqual({ paidBani: 20000, paymentState: 'partial' })

      await receive(order, 30001)
      expect(await paymentOf(order)).toEqual({ paidBani: 50000, paymentState: 'paid' })
      expect(await advanceOf(order)).toBe(1)
      expect(await debtOfOrder(order)).toBeUndefined()
    })

    it('гостьове історичне: понад ліміт відхиляється', async () => {
      const order = await newOrder({ historical: true, guest: true, retailPrice: 1000 })
      await debtOn(order, 50000)
      await receive(order, 20000)

      const tooMuch = await draftReceipt(order, 30001)
      await expect(post(tooMuch.id)).rejects.toThrow(/Overpayment.*left to pay 300\.00/)
      expect((await paymentOf(order)).paidBani).toBe(20000)
    })

    it('підсумок по клієнтах: гості в окремій групі без клієнта', async () => {
      const [mine, guest] = [await newOrder({ owner: customer }), await newOrder({ guest: true })]
      await receive(mine, 1000)

      const debts = await debtsOf({ customer })
      expect(debts.find((debt) => debt.orderId === String(mine.id))).toBeDefined()
      expect(debts.find((debt) => debt.orderId === String(guest.id))).toBeUndefined()

      const totals = await getCustomerDebtTotals(await createLocalReq({}, payload))
      expect(totals.find((total) => total.customer === customer)).toMatchObject({
        debtBani: debts.reduce((sum, debt) => sum + debt.debtBani, 0),
        orders: debts.length,
      })
      expect(totals.find((total) => total.customer === null)?.orders).toBeGreaterThanOrEqual(1)
      expect((await debtOfOrder(guest))?.customer).toBeNull()
    })
  })

  describe('opening-balances customerDebt', () => {
    it('не історичне замовлення відхиляється', async () => {
      const order = await newOrder()
      const doc = await newDebt([{ order: order.id, amountBani: 100 }])

      await expect(postDebt(doc.id)).rejects.toThrow(/only historical orders/)
    })

    it('скасоване історичне замовлення відхиляється', async () => {
      const order = await newOrder({ historical: true })
      await setStatus(order, 'cancelled')
      const doc = await newDebt([{ order: order.id, amountBani: 100 }])

      await expect(postDebt(doc.id)).rejects.toThrow(/is cancelled/)
    })

    it('неіснуюче замовлення відхиляється', async () => {
      const missing = '64b7f0f0f0f0f0f0f0f0f0f0'

      await expect(
        (async () => postDebt((await newDebt([{ order: missing, amountBani: 100 }])).id))(),
      ).rejects.toThrow(/not found/)
    })

    it('сума понад виручку відхиляється', async () => {
      const order = await newOrder({ historical: true })
      const doc = await newDebt([{ order: order.id, amountBani: 10001 }])

      await expect(postDebt(doc.id)).rejects.toThrow(/cannot exceed its total 100\.00/)
    })

    it('дубль у документі й між документами відхиляється', async () => {
      const order = await newOrder({ historical: true })

      await expect(
        newDebt([
          { order: order.id, amountBani: 100 },
          { order: order.id, amountBani: 200 },
        ]),
      ).rejects.toThrow(/only once/)

      const first = await newDebt([{ order: order.id, amountBani: 100 }])
      const second = await newDebt([{ order: order.id, amountBani: 200 }])
      await postDebt(first.id)
      await expect(postDebt(second.id)).rejects.toThrow(/already has an active opening debt/)

      // Після сторно першого рядок більше не активний.
      await reverseDebt(first.id)
      await postDebt(second.id)
      await receive(order, 200)
      expect((await paymentOf(order)).paidBani).toBe(200)
    })

    it('сторно з оплатою: у клієнта оплата йде на аванс, у гостя відхиляється; без оплат дозволене', async () => {
      const order = await newOrder({ historical: true })
      const first = await debtOn(order, 5000)
      await receive(order, 1000)

      await reverseDebt(first.id)
      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid' })
      expect(await advanceOf(order)).toBe(1000)

      const guest = await newOrder({ historical: true, guest: true })
      const guestDebt = await debtOn(guest, 5000)
      await receive(guest, 1000)
      await expect(reverseDebt(guestDebt.id)).rejects.toThrow(/has payments/)

      const free = await newOrder({ historical: true })
      const second = await debtOn(free, 5000)
      await reverseDebt(second.id)

      // Борг більше не активний: оплата знову відхиляється.
      await expect(post((await draftReceipt(free, 100)).id)).rejects.toThrow(/has not deducted stock/)
    })

    it('гостьове: дві паралельні оплати понад ліміт історичного замовлення: рівно один успіх', async () => {
      const order = await newOrder({ historical: true, guest: true, retailPrice: 1000 })
      await debtOn(order, 50000)
      const [a, b] = [await draftReceipt(order, 30000), await draftReceipt(order, 30000)]

      const results = await Promise.allSettled([post(a.id), post(b.id)])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await paymentOf(order)).toEqual({ paidBani: 30000, paymentState: 'partial' })
    })
  })
})
