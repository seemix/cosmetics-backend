import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { customerStatement } from '@/endpoints/customerStatement'
import type { CashOperation, Order, User } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { getCustomerStatement } from '@/services/finance/customerStatement.service'
import { dayKey, periodBounds } from '@/utilities/period'

import { TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import { shiftDay } from './helpers/reports'
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
let customer: string
let balanceId: string
let order: Order
let previousSettings: Record<string, unknown>

const tag = `CSTM-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []
const operations: Array<number | string> = []
const today = dayKey(new Date())
const twoDaysAgo = shiftDay(today, -2)

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const settings = (patch: Record<string, unknown>) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: patch as never })

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

type PaymentType = Extract<CashOperation['type'], 'customer_receipt' | 'customer_refund'>

const pay = async (type: PaymentType, amountBani: number, extra: { operationDate?: string; order?: Order } = {}) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: {
      status: 'draft',
      operationDate: extra.operationDate ?? new Date().toISOString(),
      type,
      account,
      amountBani,
      customer,
      ...(extra.order ? { order: extra.order.id } : {}),
    },
    ...asAdmin,
  })
  operations.push(doc.id)
  return payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, ...asAdmin })
}

const statementFor = async (from: string, to: string) => {
  const { from: start, to: end } = periodBounds(from, to)
  return getCustomerStatement(await createLocalReq({}, payload), { customer, from, to, start, end })
}

const callEndpoint = async (query: Record<string, string>, user: User | null = admin) => {
  const req = await createLocalReq(
    { user: (user ?? undefined) as never, req: { searchParams: new URLSearchParams(query), routeParams: { id: balanceId } } as never },
    payload,
  )
  return customerStatement.handler(req)
}

describe('Виписка по клієнту (розд. 6.5)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    brand = String((await data.brand()).id)
    customer = String((await data.user()).id)

    warehouse = String((await payload.create({ collection: 'warehouses', data: { name: `${tag} shop`, code: `${tag}-shop` } })).id)
    warehouses.push(warehouse)
    account = String(
      (await payload.create({ collection: 'cash-accounts', data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' } })).id,
    )
    await inTransaction(payload, (req) =>
      applyCashMoves(req, { doc: { collection: 'test-docs', id: 'statement-funding' }, lines: [{ account, deltaBani: 100_000 }] }),
    )

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
      lockedUntil: before.lockedUntil ?? null,
    }
    await settings({ stockControlEnabled: true, defaultAdminWarehouse: warehouse, lockedUntil: null })

    // Аванс 50,00 за два дні до замовлення.
    await pay('customer_receipt', 5000, { operationDate: `${twoDaysAgo}T10:00:00.000Z` })

    const product = String((await data.product({ brand, retailPrice: 100 })).id)
    products.push(product)
    await stockUp(payload, product, warehouse, 5, 5000)
    order = await payload.create({
      collection: 'orders',
      user: admin,
      data: { items: [{ product, quantity: 1, price: 0 }], total: 0, customer } as never,
      depth: 0,
    })
    orders.push(String(order.id))

    await pay('customer_receipt', 3000, { order })
    const mistaken = await pay('customer_receipt', 1000)
    await payload.update({
      collection: 'cash-operations',
      id: mistaken.id,
      data: { status: 'reversed', reversalReason: 'entered by mistake' },
      ...asAdmin,
    })

    const { docs } = await payload.find({ collection: 'customer-balances', where: { customer: { equals: customer } }, depth: 0 })
    balanceId = String(docs[0].id)
  })

  afterAll(async () => {
    await settings({ stockControlEnabled: previousSettings.stockControlEnabled === true })
    await settings(previousSettings).catch(() => {})
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'customer-moves', where: { customer: { equals: customer } } })
    await payload.delete({ collection: 'customer-balances', where: { customer: { equals: customer } } })
    await payload.delete({ collection: 'cash-moves', where: { account: { equals: account } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { equals: account } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('баланс клієнта: борг 20,00, аванс 0, сальдо 20,00', async () => {
    const doc = await payload.findByID({ collection: 'customer-balances', id: balanceId, depth: 0 })

    expect(doc).toMatchObject({ debtBani: 2000, balanceBani: 0, netBani: 2000 })
  })

  it('сальдо на початок, рухи періоду з сальдо після кожного, сальдо на кінець = netBani', async () => {
    const statement = await statementFor(shiftDay(today, -1), today)

    expect(statement.openingBani).toBe(-5000)
    expect(statement.lines.map(({ kind, chargedBani, paidBani, balanceBani, orderNumber }) => ({ kind, chargedBani, paidBani, balanceBani, orderNumber }))).toEqual([
      { kind: 'order', chargedBani: 10000, paidBani: 0, balanceBani: 5000, orderNumber: order.orderNumber },
      { kind: 'receipt', chargedBani: 0, paidBani: 3000, balanceBani: 2000, orderNumber: order.orderNumber },
      { kind: 'receipt', chargedBani: 0, paidBani: 1000, balanceBani: 1000, orderNumber: null },
      { kind: 'receiptReversal', chargedBani: 0, paidBani: -1000, balanceBani: 2000, orderNumber: null },
    ])
    expect(statement).toMatchObject({ chargedBani: 10000, paidBani: 3000, closingBani: 2000 })
  })

  it('нараховане в періоді замовлення має позиції й залишок', async () => {
    const statement = await statementFor(today, today)

    expect(statement.lines[0]).toMatchObject({ kind: 'order', orderId: String(order.id) })
    expect(Object.values(statement.orders)).toEqual([
      expect.objectContaining({
        number: order.orderNumber,
        totalBani: 10000,
        paidBani: 8000,
        dueBani: 2000,
        paymentState: 'partial',
        items: [expect.objectContaining({ quantity: 1, priceBani: 10000, amountBani: 10000 })],
      }),
    ])
  })

  it('період до будь-яких рухів: порожньо, сальдо 0; період з першим надходженням починається з 0', async () => {
    const empty = await statementFor(shiftDay(twoDaysAgo, -5), shiftDay(twoDaysAgo, -1))
    expect(empty).toMatchObject({ openingBani: 0, closingBani: 0, lines: [], orders: {} })

    const full = await statementFor(twoDaysAgo, today)
    expect(full.openingBani).toBe(0)
    expect(full.lines[0]).toMatchObject({ kind: 'receipt', paidBani: 5000, balanceBani: -5000 })
    expect(full.closingBani).toBe(2000)
  })

  describe('ендпоінт', () => {
    it('admin отримує HTML-файл: одна таблиця, позиції замовлення під його рядком', async () => {
      const response = await callEndpoint({ from: shiftDay(today, -1), to: today })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename=".+\.html"/)

      const html = await response.text()
      expect(html.match(/<table/g)).toHaveLength(1)
      expect(html).toContain('Opening balance')
      expect(html).toContain('-50.00')
      expect(html).toContain('Closing balance')

      // Рядок нарахування замовлення, одразу за ним позиція й стан оплати, потім наступний рух.
      const orderRow = html.indexOf(`Order ${order.orderNumber}<`)
      const item = html.indexOf('1 × 100.00 = 100.00')
      const summary = html.indexOf('paid 80.00, left to pay 20.00')
      const nextPayment = html.indexOf(`Payment received, order ${order.orderNumber}`)
      expect(orderRow).toBeGreaterThan(0)
      expect(item).toBeGreaterThan(orderRow)
      expect(summary).toBeGreaterThan(item)
      expect(nextPayment).toBeGreaterThan(summary)
    })

    it('не-admin 403, гість 401; неправильний період 400; невідомий баланс 404', async () => {
      const manager = { id: 'manager', roles: ['manager'], collection: 'users' } as unknown as User

      expect((await callEndpoint({ from: today, to: today }, manager)).status).toBe(403)
      expect((await callEndpoint({ from: today, to: today }, null)).status).toBe(401)
      expect((await callEndpoint({ from: today, to: shiftDay(today, -1) })).status).toBe(400)
      expect((await callEndpoint({ from: 'abc', to: today })).status).toBe(400)

      const req = await createLocalReq(
        { user: admin as never, req: { searchParams: new URLSearchParams({ from: today, to: today }), routeParams: { id: '64b7f0f0f0f0f0f0f0f0f0f0' } } as never },
        payload,
      )
      expect((await customerStatement.handler(req)).status).toBe(404)
    })
  })
})
