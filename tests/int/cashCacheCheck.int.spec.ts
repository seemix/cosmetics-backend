import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  type CashCacheDiscrepancy,
  cashCacheCheck,
  cashCacheRebuild,
  checkCashCache,
  fixCashCache,
} from '@/endpoints/cashCacheCheck'
import config from '@/payload.config'
import type { CashOperation, Order } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import {
  type AuthUser,
  cleanupStock,
  createAdmin,
  deleteDocumentsDirectly,
  inTransaction,
  stockUp,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let customer: string
let brand: string
let warehouse: string
let previousSettings: Record<string, unknown>

const tag = `CCCH-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []
const accounts: string[] = []
const operations: Array<number | string> = []
const fundingDoc = { collection: 'test-docs', id: 'cash-cache-funding' }
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

const newAccount = async (suffix: string, extra: { allowNegative?: boolean } = {}) => {
  const doc = await payload.create({
    collection: 'cash-accounts',
    data: { name: `${tag} ${suffix}`, code: `${tag}-${suffix}`, kind: 'cash', ...extra },
  })
  accounts.push(String(doc.id))
  return String(doc.id)
}

const fund = (account: string, deltaBani: number) =>
  inTransaction(payload, (req) => applyCashMoves(req, { doc: fundingDoc, lines: [{ account, deltaBani }] }))

const newOrder = async (): Promise<Order> => {
  const product = String((await data.product({ brand, retailPrice: 100 })).id)
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

type PaymentType = Extract<CashOperation['type'], 'customer_receipt' | 'customer_refund'>

const pay = async (type: PaymentType, order: Order, account: string, amountBani: number) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', type, account, amountBani, order: order.id },
    ...asAdmin,
  })
  operations.push(doc.id)
  return payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, ...asAdmin })
}

const reverse = (id: number | string) =>
  payload.update({
    collection: 'cash-operations',
    id,
    data: { status: 'reversed', reversalReason: 'entered by mistake' },
    ...asAdmin,
  })

/** Сирий запис, що обходить сервіси: так кеш ламається в реальності. */
const rawSet = async (slug: 'cash-accounts' | 'orders', id: string, patch: Record<string, unknown>) => {
  const model = payload.db.collections[slug]
  await model.collection.updateOne({ _id: new model.base.Types.ObjectId(id) }, { $set: patch })
}

const orderOf = (order: Order) => payload.findByID({ collection: 'orders', id: order.id, depth: 0 })
const balanceOf = async (id: string) =>
  (await payload.findByID({ collection: 'cash-accounts', id, depth: 0 })).balanceBani

/** Розбіжності лише по тестових касах і замовленнях: у спільній БД можуть бути чужі. */
const mine = (items: CashCacheDiscrepancy[]) =>
  items.filter((item) => (item.entity === 'cash-account' ? accounts : orders).includes(item.id))
const only = (items: CashCacheDiscrepancy[], ...ids: string[]) => items.filter((item) => ids.includes(item.id))
const found = async () => mine(await checkCashCache(await createLocalReq({}, payload)))

const callEndpoint = async (endpoint: typeof cashCacheCheck, roles?: Array<'admin' | 'customer'>, url?: string) => {
  const req = await createLocalReq(
    { user: roles ? ({ id: 'u', roles, collection: 'users' } as never) : undefined },
    payload,
  )
  if (url) Object.defineProperty(req, 'searchParams', { value: new URL(url, 'http://localhost').searchParams })
  const response = await endpoint.handler(req)

  return { status: response.status, body: await response.json() }
}

describe('C6: перевірка кешу кас і оплат', () => {
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
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'cash-moves', where: { account: { in: accounts } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { in: accounts } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('кеш, зібраний сервісами (надходження, повернення, сторно), збігається з журналами', async () => {
    const account = await newAccount('clean')
    const order = await newOrder()
    await pay('customer_receipt', order, account, 6000)
    await pay('customer_refund', order, account, 1000)
    const mistaken = await pay('customer_receipt', order, account, 2000)
    await reverse(mistaken.id)

    expect((await orderOf(order)).paidBani).toBe(5000)
    expect(await balanceOf(account)).toBe(5000)
    expect(await found()).toEqual([])
  })

  it('check знаходить зіпсовані balanceBani і paidBani', async () => {
    const account = await newAccount('broken')
    await fund(account, 10000)
    const order = await newOrder()
    await pay('customer_receipt', order, account, 4000)
    await rawSet('cash-accounts', account, { balanceBani: 12345 })
    await rawSet('orders', String(order.id), { paidBani: 9000 })

    expect(await found()).toEqual([
      { type: 'balance', entity: 'cash-account', id: account, expected: 14000, actual: 12345 },
      {
        type: 'orderPaid',
        entity: 'order',
        id: String(order.id),
        number: order.orderNumber,
        expected: 4000,
        actual: 9000,
      },
    ])

    // Розбіжності не лишаються для наступних тестів: fix перебудовує кеш усієї БД.
    await rawSet('cash-accounts', account, { balanceBani: 14000 })
    await rawSet('orders', String(order.id), { paidBani: 4000 })
  })

  it('fix виправляє balanceBani з журналу; paidBani лише з прапорцем; потім check чистий', async () => {
    const account = await newAccount('fix')
    await fund(account, 10000)
    const order = await newOrder()
    await pay('customer_receipt', order, account, 4000)
    await rawSet('cash-accounts', account, { balanceBani: 1 })
    await rawSet('orders', String(order.id), { paidBani: 9000, paymentState: 'partial' })
    const log = vi.spyOn(payload.logger, 'info')

    const withoutOrders = await fixCashCache(await createLocalReq({}, payload))
    expect(only(withoutOrders.fixed, account, String(order.id)).map((item) => item.type)).toEqual(['balance'])
    expect(only(withoutOrders.skipped, account, String(order.id)).map((item) => item.type)).toEqual(['orderPaid'])
    expect(await balanceOf(account)).toBe(14000)
    expect((await orderOf(order)).paidBani).toBe(9000)

    const withOrders = await fixCashCache(await createLocalReq({}, payload), { orders: true })
    expect(only(withOrders.fixed, account, String(order.id)).map((item) => item.type)).toEqual(['orderPaid'])
    expect(await orderOf(order)).toMatchObject({ paidBani: 4000, paymentState: 'partial' })
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ msg: 'cash cache fixed', type: 'balance', id: account }))
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'cash cache fixed', type: 'orderPaid', id: String(order.id) }),
    )

    expect(await found()).toEqual([])
  })

  it('fix перераховує paymentState: paid і unpaid', async () => {
    const account = await newAccount('state')
    const [full, empty] = [await newOrder(), await newOrder()]
    await pay('customer_receipt', full, account, 10000)
    await rawSet('orders', String(full.id), { paidBani: 3000, paymentState: 'partial' })
    await rawSet('orders', String(empty.id), { paidBani: 500, paymentState: 'partial' })

    await fixCashCache(await createLocalReq({}, payload), { orders: true })

    expect(await orderOf(full)).toMatchObject({ paidBani: 10000, paymentState: 'paid' })
    expect(await orderOf(empty)).toMatchObject({ paidBani: 0, paymentState: 'unpaid' })
  })

  it("від'ємний баланс при allowNegative = false відзначається й не виправляється перебудовою", async () => {
    const account = await newAccount('negative')
    await fund(account, 1000)
    await rawSet('cash-accounts', account, { balanceBani: -100 })

    expect(await found()).toEqual([
      { type: 'balance', entity: 'cash-account', id: account, expected: 1000, actual: -100 },
      { type: 'negativeBalance', entity: 'cash-account', id: account, expected: 0, actual: -100 },
    ])

    const result = await fixCashCache(await createLocalReq({}, payload))
    expect(mine(result.skipped).map((item) => item.type)).toEqual(['negativeBalance'])
    expect(await balanceOf(account)).toBe(1000)
    expect(await found()).toEqual([])
  })

  it("від'ємний баланс при allowNegative = true не є розбіжністю", async () => {
    const account = await newAccount('allowed', { allowNegative: true })
    await fund(account, -300)

    expect(await balanceOf(account)).toBe(-300)
    expect(await found()).toEqual([])
  })

  describe('ендпоінти', () => {
    it('не-admin отримує 403, гість 401', async () => {
      for (const endpoint of [cashCacheCheck, cashCacheRebuild]) {
        expect((await callEndpoint(endpoint, ['customer'])).status).toBe(403)
        expect((await callEndpoint(endpoint)).status).toBe(401)
      }
    })

    it('admin: check повертає розбіжності, rebuild виправляє (paidBani лише з ?orders=true)', async () => {
      const account = await newAccount('endpoint')
      await fund(account, 2000)
      const order = await newOrder()
      await pay('customer_receipt', order, account, 4000)
      await rawSet('cash-accounts', account, { balanceBani: 7 })
      await rawSet('orders', String(order.id), { paidBani: 1 })

      const check = await callEndpoint(cashCacheCheck, ['admin'])
      expect(check.status).toBe(200)
      expect(check.body.ok).toBe(false)
      expect(
        mine(check.body.discrepancies)
          .map((item) => item.type)
          .sort(),
      ).toEqual(['balance', 'orderPaid'])

      const rebuild = await callEndpoint(cashCacheRebuild, ['admin'])
      expect(rebuild.status).toBe(200)
      expect(await balanceOf(account)).toBe(6000)
      expect((await orderOf(order)).paidBani).toBe(1)

      await callEndpoint(cashCacheRebuild, ['admin'], '/cash/cache-rebuild?orders=true')
      expect((await orderOf(order)).paidBani).toBe(4000)
      expect(await found()).toEqual([])
    })
  })
})
