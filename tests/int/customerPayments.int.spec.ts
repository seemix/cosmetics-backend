import axios from 'axios'
import { createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import type { CashOperation, Order } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { getOrderRevenueBani } from '@/services/finance/orderPayments.service'

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
let customer: string
let brand: string
let warehouse: string
let rent: string
let previousSettings: Record<string, unknown>

const tag = `CPAY-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []
const accounts: string[] = []
const operations: Array<number | string> = []
const customers: string[] = []
const fundingDoc = { collection: 'test-docs', id: 'customer-payments-funding' }
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

const newAccount = async (suffix: string) => {
  const doc = await payload.create({
    collection: 'cash-accounts',
    data: { name: `${tag} ${suffix}`, code: `${tag}-${suffix}`, kind: 'cash' },
  })
  accounts.push(String(doc.id))
  return String(doc.id)
}

const fund = (account: string, amountBani: number) =>
  inTransaction(payload, (req) => applyCashMoves(req, { doc: fundingDoc, lines: [{ account, deltaBani: amountBani }] }))

const balanceOf = async (id: string) =>
  (await payload.findByID({ collection: 'cash-accounts', id, depth: 0 })).balanceBani

const movesOf = async (id: number | string) =>
  (
    await payload.find({
      collection: 'cash-moves',
      where: { docCollection: { equals: 'cash-operations' }, docId: { equals: String(id) } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

const newCustomer = async () => {
  const id = String((await data.user()).id)
  customers.push(id)
  return id
}

/**
 * Замовлення з адмінки на 1 шт. за 100,00: проводиться, якщо облік увімкнено. Кожне має свого
 * клієнта, бо гроші клієнта гасять усі його борги (розд. 6.4); гостьове без клієнта.
 */
const newOrder = async (options: { guest?: boolean } = {}): Promise<Order> => {
  const product = String((await data.product({ brand, retailPrice: 100 })).id)
  products.push(product)
  await stockUp(payload, product, warehouse, 5, 5000)

  const order = await payload.create({
    collection: 'orders',
    user: admin,
    data: {
      items: [{ product, quantity: 1, price: 0 }],
      total: 0,
      ...(options.guest ? {} : { customer: await newCustomer() }),
    } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  return order
}

const advanceOf = async (order: Order) => {
  const { docs } = await payload.find({
    collection: 'customer-balances',
    where: { customer: { equals: idOf(order.customer) } },
    depth: 0,
  })
  return docs[0]?.balanceBani ?? 0
}

const orderOf = (order: Order) => payload.findByID({ collection: 'orders', id: order.id, depth: 0 })

const paymentOf = async (order: Order) => {
  const doc = await orderOf(order)
  return { paidBani: doc.paidBani, paymentState: doc.paymentState, status: doc.status }
}

const setStatus = (order: Order, status: Order['status']) =>
  payload.update({ collection: 'orders', id: order.id, user: admin, data: { status }, depth: 0 })

type PaymentType = Extract<CashOperation['type'], 'customer_receipt' | 'customer_refund'>

const draft = async (type: PaymentType, order: Order, account: string, amountBani: number) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', type, account, amountBani, order: order.id },
    ...asAdmin,
  })
  operations.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'cash-operations',
    id,
    data: { status: 'reversed', reversalReason: 'entered by mistake' },
    ...asAdmin,
  })

/** Створення й проведення операції оплати. */
const pay = async (type: PaymentType, order: Order, account: string, amountBani: number) => {
  const doc = await draft(type, order, account, amountBani)
  return post(doc.id)
}

const statusOf = async (id: number | string) => (await payload.findByID({ collection: 'cash-operations', id })).status

describe('C3: надходження й повернення від покупця', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    customer = String((await data.user()).id)
    brand = String((await data.brand()).id)

    const doc = await payload.create({ collection: 'warehouses', data: { name: `${tag} shop`, code: `${tag}-shop` } })
    warehouse = String(doc.id)
    warehouses.push(warehouse)

    const category = await payload.create({
      collection: 'expense-categories',
      data: { name: `${tag} rent`, code: `${tag}-rent` },
    })
    rent = String(category.id)

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
    await payload.delete({ collection: 'expense-categories', where: { id: { equals: rent } } })
    await payload.delete({ collection: 'customer-moves', where: { order: { in: orders } } })
    await payload.delete({ collection: 'customer-moves', where: { customer: { in: customers } } })
    await payload.delete({ collection: 'customer-balances', where: { customer: { in: customers } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  describe('customer_receipt', () => {
    it('оновлює cash-moves, баланс каси, paidBani і paymentState; status замовлення не змінюється', async () => {
      const account = await newAccount('receipt')
      const order = await newOrder()
      expect(getOrderRevenueBani(order)).toBe(10000)
      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid', status: 'pending' })

      const first = await pay('customer_receipt', order, account, 4000)

      expect(idOf(first.customer)).toBe(idOf(order.customer))
      expect(await balanceOf(account)).toBe(4000)
      expect((await movesOf(first.id)).map((move) => [String(move.account), move.deltaBani])).toEqual([[account, 4000]])
      expect(await paymentOf(order)).toEqual({ paidBani: 4000, paymentState: 'partial', status: 'pending' })

      await pay('customer_receipt', order, account, 6000)

      expect(await balanceOf(account)).toBe(10000)
      expect(await paymentOf(order)).toEqual({ paidBani: 10000, paymentState: 'paid', status: 'pending' })
    })

    it('переплата клієнта йде в аванс', async () => {
      const account = await newAccount('overpay')
      const order = await newOrder()
      await pay('customer_receipt', order, account, 9000)

      await pay('customer_receipt', order, account, 1001)

      expect(await balanceOf(account)).toBe(10001)
      expect(await paymentOf(order)).toMatchObject({ paidBani: 10000, paymentState: 'paid' })
      expect(await advanceOf(order)).toBe(1)
    })

    it('переплата гостьового замовлення відхиляється, документ лишається чернеткою', async () => {
      const account = await newAccount('overpay-guest')
      const order = await newOrder({ guest: true })
      await pay('customer_receipt', order, account, 9000)

      const doc = await draft('customer_receipt', order, account, 1001)
      await expect(post(doc.id)).rejects.toThrow(/Overpayment.*left to pay 10\.00/)

      expect(await statusOf(doc.id)).toBe('draft')
      expect(await balanceOf(account)).toBe(9000)
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await paymentOf(order)).toMatchObject({ paidBani: 9000, paymentState: 'partial' })
    })

    it('дві паралельні надходження понад суму замовлення: гроші не губляться й не дублюються', async () => {
      const account = await newAccount('race')
      const order = await newOrder()
      const [a, b] = [
        await draft('customer_receipt', order, account, 6000),
        await draft('customer_receipt', order, account, 6000),
      ]

      const results = await Promise.allSettled([post(a.id), post(b.id)])
      const received = 6000 * results.filter((result) => result.status === 'fulfilled').length

      // Конфлікт запису може відхилити одне з проведень; що пройшло, те й розподілено.
      expect(received).toBeGreaterThan(0)
      expect(await balanceOf(account)).toBe(received)
      expect((await paymentOf(order)).paidBani).toBe(Math.min(received, 10000))
      expect(await advanceOf(order)).toBe(received - Math.min(received, 10000))
    })

    it('скасоване замовлення не приймає оплату', async () => {
      const account = await newAccount('cancelled')
      const order = await newOrder()
      await setStatus(order, 'cancelled')

      const doc = await draft('customer_receipt', order, account, 100)
      await expect(post(doc.id)).rejects.toThrow(/is cancelled/)

      expect(await balanceOf(account)).toBe(0)
      expect(await paymentOf(order)).toMatchObject({ paidBani: 0, paymentState: 'unpaid' })
    })

    it('замовлення без stockPostedAt не приймає оплату', async () => {
      const account = await newAccount('not-posted')
      await settings({ stockControlEnabled: false })
      const order = await newOrder().finally(() => settings({ stockControlEnabled: true }))
      expect(order.accounting?.stockPostedAt ?? null).toBeNull()

      const doc = await draft('customer_receipt', order, account, 100)
      await expect(post(doc.id)).rejects.toThrow(/has not deducted stock/)

      expect(await balanceOf(account)).toBe(0)
      expect((await paymentOf(order)).paidBani).toBe(0)
    })

    it('клієнт або замовлення обов\'язкові, поля інших типів очищаються', async () => {
      const account = await newAccount('no-order')

      await expect(
        payload.create({
          collection: 'cash-operations',
          data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', type: 'customer_receipt', account, amountBani: 100 },
          ...asAdmin,
        }),
      ).rejects.toThrow(/Select the customer or the order/)

      const order = await newOrder()
      const expense = await payload.create({
        collection: 'cash-operations',
        data: {
          status: 'draft',
          operationDate: '2026-10-25T00:00:00.000Z',
          type: 'expense',
          account,
          amountBani: 100,
          category: rent,
          order: order.id,
          customer,
        },
        ...asAdmin,
      })
      operations.push(expense.id)

      expect(expense.order ?? null).toBeNull()
      expect(expense.customer ?? null).toBeNull()
    })

    it('гостьове замовлення приймає оплату, customer порожній', async () => {
      const account = await newAccount('guest')
      const order = await newOrder({ guest: true })

      const doc = await pay('customer_receipt', order, account, 10000)

      expect(doc.customer ?? null).toBeNull()
      expect(await paymentOf(order)).toMatchObject({ paidBani: 10000, paymentState: 'paid' })
    })
  })

  describe('customer_refund', () => {
    it('більше за paidBani відхиляється; після повернення paidBani і paymentState правильні', async () => {
      const account = await newAccount('refund')
      const order = await newOrder()
      await pay('customer_receipt', order, account, 10000)

      const tooMuch = await draft('customer_refund', order, account, 10001)
      await expect(post(tooMuch.id)).rejects.toThrow(/only 100\.00 paid/)

      const refund = await pay('customer_refund', order, account, 3000)
      expect((await movesOf(refund.id)).map((move) => move.deltaBani)).toEqual([-3000])
      expect(await balanceOf(account)).toBe(7000)
      expect(await paymentOf(order)).toEqual({ paidBani: 7000, paymentState: 'partial', status: 'pending' })

      await pay('customer_refund', order, account, 7000)
      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid', status: 'pending' })
      expect(await balanceOf(account)).toBe(0)
    })

    it('повернення на скасованому замовленні дозволене', async () => {
      const account = await newAccount('refund-cancelled')
      await fund(account, 5000)
      // Історичне гостьове замовлення з оплатою: без stockPostedAt скасування лише змінює статус
      // (у замовлення клієнта оплата при скасуванні пішла б на аванс).
      await settings({ stockControlEnabled: false })
      const order = await newOrder({ guest: true }).finally(() => settings({ stockControlEnabled: true }))
      await payload.update({ collection: 'orders', id: order.id, data: { paidBani: 5000, paymentState: 'partial' }, depth: 0 })
      await setStatus(order, 'cancelled')

      await pay('customer_refund', order, account, 3000)

      expect(await paymentOf(order)).toEqual({ paidBani: 2000, paymentState: 'partial', status: 'cancelled' })
      expect(await balanceOf(account)).toBe(2000)
    })

    it('нестача в касі: замовлення й каси без змін', async () => {
      const [income, empty] = [await newAccount('refund-income'), await newAccount('refund-empty')]
      const order = await newOrder()
      await pay('customer_receipt', order, income, 5000)

      const doc = await draft('customer_refund', order, empty, 5000)
      await expect(post(doc.id)).rejects.toThrow(/Insufficient funds/)

      expect(await paymentOf(order)).toMatchObject({ paidBani: 5000, paymentState: 'partial' })
      expect([await balanceOf(income), await balanceOf(empty)]).toEqual([5000, 0])
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await statusOf(doc.id)).toBe('draft')
    })
  })

  describe('сторно', () => {
    it('сторно надходження повертає paidBani і баланс каси', async () => {
      const account = await newAccount('rev-receipt')
      const order = await newOrder()
      const receipt = await pay('customer_receipt', order, account, 10000)

      await reverse(receipt.id)

      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid', status: 'pending' })
      expect(await balanceOf(account)).toBe(0)
      const [original, mirror] = await movesOf(receipt.id)
      expect(mirror).toMatchObject({ deltaBani: -10000, reversalOf: original.id })
    })

    it('сторно надходження відхиляється, якщо гроші клієнта вже повернули', async () => {
      const account = await newAccount('rev-receipt-paid')
      const order = await newOrder()
      const receipt = await pay('customer_receipt', order, account, 5000)
      await pay('customer_refund', order, account, 3000)

      await expect(reverse(receipt.id)).rejects.toThrow(/only 20\.00 of paid money left/)

      expect(await statusOf(receipt.id)).toBe('posted')
      expect(await paymentOf(order)).toMatchObject({ paidBani: 2000, paymentState: 'partial' })
      expect(await balanceOf(account)).toBe(2000)
    })

    it('сторно надходження відхиляється, якщо в касі недостатньо коштів', async () => {
      const account = await newAccount('rev-receipt-cash')
      const order = await newOrder()
      const receipt = await pay('customer_receipt', order, account, 5000)
      const spent = await payload.create({
        collection: 'cash-operations',
        data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', type: 'expense', account, amountBani: 3000, category: rent },
        ...asAdmin,
      })
      operations.push(spent.id)
      await post(spent.id)

      await expect(reverse(receipt.id)).rejects.toThrow(/Insufficient funds/)

      expect(await statusOf(receipt.id)).toBe('posted')
      expect(await paymentOf(order)).toMatchObject({ paidBani: 5000, paymentState: 'partial' })
      expect(await balanceOf(account)).toBe(2000)
    })

    it('сторно повернення повертає paidBani; по скасованому замовленню гроші йдуть на аванс', async () => {
      const account = await newAccount('rev-refund')
      const order = await newOrder()
      await pay('customer_receipt', order, account, 10000)
      const partial = await pay('customer_refund', order, account, 4000)

      await reverse(partial.id)
      expect(await paymentOf(order)).toMatchObject({ paidBani: 10000, paymentState: 'paid' })
      expect(await balanceOf(account)).toBe(10000)

      const full = await pay('customer_refund', order, account, 10000)
      await setStatus(order, 'cancelled')

      await reverse(full.id)
      expect(await statusOf(full.id)).toBe('reversed')
      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid', status: 'cancelled' })
      expect(await advanceOf(order)).toBe(10000)
      expect(await balanceOf(account)).toBe(10000)
    })

    it('гостьове: сторно повернення на скасованому замовленні відхиляється', async () => {
      const account = await newAccount('rev-refund-guest')
      const order = await newOrder({ guest: true })
      await pay('customer_receipt', order, account, 10000)
      const full = await pay('customer_refund', order, account, 10000)
      await setStatus(order, 'cancelled')

      await expect(reverse(full.id)).rejects.toThrow(/is cancelled/)
      expect(await statusOf(full.id)).toBe('posted')
      expect(await paymentOf(order)).toEqual({ paidBani: 0, paymentState: 'unpaid', status: 'cancelled' })
      expect(await balanceOf(account)).toBe(0)
    })
  })

  describe('замовлення й транзакція', () => {
    it('оплачене замовлення клієнта скасовується, оплата йде на аванс', async () => {
      const account = await newAccount('cancel-paid')
      const order = await newOrder()
      await pay('customer_receipt', order, account, 10000)

      const cancelled = await setStatus(order, 'cancelled')

      expect(cancelled).toMatchObject({ status: 'cancelled', paidBani: 0, paymentState: 'unpaid' })
      expect(await advanceOf(order)).toBe(10000)
      expect(await balanceOf(account)).toBe(10000)
    })

    it('оплачене гостьове замовлення не скасовується; після повного повернення скасування проходить', async () => {
      const account = await newAccount('cancel-paid-guest')
      const order = await newOrder({ guest: true })
      await pay('customer_receipt', order, account, 10000)

      await expect(setStatus(order, 'cancelled')).rejects.toThrow(/refund the customer/)
      expect((await orderOf(order)).status).toBe('pending')

      await pay('customer_refund', order, account, 10000)
      const cancelled = await setStatus(order, 'cancelled')

      expect(cancelled.status).toBe('cancelled')
    })

    it('відкат транзакції: cash-moves, balanceBani і paidBani без змін', async () => {
      const account = await newAccount('rollback')
      const order = await newOrder()
      const doc = await draft('customer_receipt', order, account, 4000)

      const req = await createLocalReq({ user: admin }, payload)
      await initTransaction(req)
      await payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, req, overrideAccess: false })
      await killTransaction(req)

      expect(await balanceOf(account)).toBe(0)
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await paymentOf(order)).toMatchObject({ paidBani: 0, paymentState: 'unpaid' })
      expect(await statusOf(doc.id)).toBe('draft')
    })

    describe('сповіщення', () => {
      beforeEach(() => {
        process.env.TELEGRAM_BOT_TOKEN = 'test-token'
        process.env.TELEGRAM_CHAT_ID = 'test-chat'
      })

      it('оплата, повернення й сторно не викликають листів і Telegram; updatedAt оновлюється', async () => {
        const account = await newAccount('notify')
        const telegram = vi.spyOn(axios, 'post').mockResolvedValue({ data: { result: { message_id: 1 } } })
        const order = await newOrder()
        // Хуки сповіщень після коміту асинхронні: даємо їм завершитись.
        await new Promise((resolve) => setTimeout(resolve, 50))
        const sendEmail = vi.mocked(payload.sendEmail)
        // Шпигуни працюють: створення замовлення надсилає і лист, і Telegram.
        expect(sendEmail).toHaveBeenCalled()
        expect(telegram).toHaveBeenCalled()
        sendEmail.mockClear()
        telegram.mockClear()

        await pay('customer_receipt', order, account, 6000)
        const refund = await pay('customer_refund', order, account, 1000)
        await reverse(refund.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(sendEmail).not.toHaveBeenCalled()
        expect(telegram).not.toHaveBeenCalled()
        const doc = await orderOf(order)
        expect(new Date(doc.updatedAt).getTime()).toBeGreaterThan(new Date(order.updatedAt).getTime())
      })
    })
  })
})
