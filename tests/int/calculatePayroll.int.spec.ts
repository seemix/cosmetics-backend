import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { calculatePayroll, type PayrollOrderData } from '@/services/salary/calculatePayroll'
import { endOfDay, periodBounds, startOfDay } from '@/utilities/period'
import { pickScheme } from '@/services/salary/pickScheme'
import { selectPayrollOrders, type PayrollSelectionScheme } from '@/services/salary/selectPayrollOrders'

import { TestData } from './helpers/fixtures'
import { insertOrder, makeUser, rejectsWith, type RawOrder } from './helpers/salary'
import { deleteDocumentsDirectly, inTransaction, type AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let req: PayloadRequest
let admin: AuthUser
let account: string
let previousLockedUntil: string | null = null

const tag = `SAL1-${Date.now()}`
const orders: string[] = []
const schemes: string[] = []
const operations: Array<number | string> = []
const accounts: string[] = []

/** Вересень 2026: межі в поясі обліку (Europe/Chisinau, UTC+3 улітку). */
const SEPTEMBER = periodBounds('2026-09-01', '2026-09-30')
const MID_SEPTEMBER = new Date('2026-09-15T09:00:00.000Z')
const DEFAULT_SCHEME: PayrollSelectionScheme = { dateBasis: 'order_date', attribution: 'snapshot', customerFilter: 'all' }

const order = async (fields: RawOrder) => {
  const id = await insertOrder(payload, fields)
  orders.push(id)
  return id
}

const select = async (manager: AuthUser, scheme: Partial<PayrollSelectionScheme> = {}, bounds = SEPTEMBER) =>
  (await selectPayrollOrders(req, { manager: String(manager.id), ...bounds, scheme: { ...DEFAULT_SCHEME, ...scheme } }))
    .map((row) => row.id)
    .sort()

const sorted = (...ids: string[]) => [...ids].sort()

const manager = () => makeUser(payload, data, ['manager'])

const scheme = async (fields: Record<string, unknown>) => {
  const doc = await payload.create({
    collection: 'salary-schemes',
    data: { name: `${tag} scheme`, percentBp: 1000, base: 'revenue', dateBasis: 'order_date', attribution: 'snapshot', ...fields } as never,
    depth: 0,
  })
  schemes.push(String(doc.id))
  return String(doc.id)
}

const receipt = async (orderId: string, amountBani: number, operationDate: string) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: { status: 'draft', type: 'customer_receipt', operationDate, account, amountBani, order: orderId } as never,
    user: admin,
    overrideAccess: false,
  })
  operations.push(doc.id)
  return payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, user: admin, overrideAccess: false })
}

const lineOf = (id: string, revenueBani: number, extra: Partial<PayrollOrderData> = {}): PayrollOrderData => ({
  id,
  orderNumber: id,
  accounting: { revenueBani, cogsBani: 0 },
  paymentState: 'unpaid',
  ...extra,
})

describe('M4 (1/2): схеми й розрахунок зарплати', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    req = await createLocalReq({}, payload)
    admin = await makeUser(payload, data, ['admin'])

    const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousLockedUntil = settings.lockedUntil ?? null
    await payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil: null } as never })

    const doc = await payload.create({
      collection: 'cash-accounts',
      data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' },
    })
    account = String(doc.id)
    accounts.push(account)
    await inTransaction(payload, (tx) =>
      applyCashMoves(tx, { doc: { collection: 'test-docs', id: tag }, lines: [{ account, deltaBani: 1 }] }),
    )
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'cash-moves', where: { account: { in: accounts } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { in: accounts } } })
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await deleteDocumentsDirectly(payload, 'salary-schemes', schemes)
    await payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil: previousLockedUntil } as never })
    await data.cleanup()
  })

  describe('calculatePayroll (чиста функція)', () => {
    it('комісія округлюється на кожен рядок: 1 525 + 12 350 + 1 = 13 876, а не 13 875 від загальної суми', () => {
      const result = calculatePayroll({
        scheme: { percentBp: 1235, base: 'revenue', fixedBani: 0 },
        orders: [lineOf('a', 12345), lineOf('b', 99999), lineOf('c', 5)],
      })

      expect(result.lines.map((line) => line.amountBani)).toEqual([1525, 12350, 1])
      expect(result.percentAmountBani).toBe(13876)
      expect(Math.round((112349 * 1235) / 10000)).toBe(13875)
      expect(result.baseTotalBani).toBe(112349)
      expect(result.totalBani).toBe(13876)
    })

    it('revenue: база = виручка; для історичного замовлення без revenueBani — total × 100', () => {
      const result = calculatePayroll({
        scheme: { percentBp: 1000, base: 'revenue' },
        orders: [lineOf('a', 10000), { id: 'old', orderNumber: '1001', total: 55.5, accounting: null }],
      })

      expect(result.lines).toEqual([
        { order: 'a', orderNumber: 'a', baseBani: 10000, amountBani: 1000 },
        { order: 'old', orderNumber: '1001', baseBani: 5550, amountBani: 555 },
      ])
    })

    it('gross_profit: виручка − собівартість; від\'ємний прибуток не обмежується нулем', () => {
      const result = calculatePayroll({
        scheme: { percentBp: 1000, base: 'gross_profit' },
        orders: [
          lineOf('a', 10000, { accounting: { revenueBani: 10000, cogsBani: 6000 } }),
          lineOf('b', 5000, { accounting: { revenueBani: 5000, cogsBani: 7000 } }),
        ],
      })

      expect(result.lines.map((line) => [line.baseBani, line.amountBani])).toEqual([
        [4000, 400],
        [-2000, -200],
      ])
      expect(result.percentAmountBani).toBe(200)
    })

    it('paid_revenue: лише повністю оплачені замовлення', () => {
      const result = calculatePayroll({
        scheme: { percentBp: 500, base: 'paid_revenue' },
        orders: [lineOf('paid', 10000, { paymentState: 'paid' }), lineOf('partial', 8000, { paymentState: 'partial' })],
      })

      expect(result.lines).toEqual([{ order: 'paid', orderNumber: 'paid', baseBani: 10000, amountBani: 500 }])
    })

    it('fixedBani і adjustmentsBani (зокрема від\'ємна) входять у totalBani', () => {
      const scheme = { percentBp: 1000, base: 'revenue' as const, fixedBani: 300000 }

      expect(calculatePayroll({ scheme, orders: [lineOf('a', 10000)], adjustmentsBani: 5000 }).totalBani).toBe(306000)
      expect(calculatePayroll({ scheme, orders: [lineOf('a', 10000)], adjustmentsBani: -20000 }).totalBani).toBe(281000)
      expect(calculatePayroll({ scheme, orders: [] }).totalBani).toBe(300000)
    })
  })

  describe('межі періоду', () => {
    it('вересень = з 00:00:00.000 1-го до 23:59:59.999 30-го за Europe/Chisinau', () => {
      expect(SEPTEMBER.from.toISOString()).toBe('2026-08-31T21:00:00.000Z')
      expect(SEPTEMBER.to.toISOString()).toBe('2026-09-30T20:59:59.999Z')
      // Узимку пояс UTC+2.
      expect(startOfDay('2026-12-01').toISOString()).toBe('2026-11-30T22:00:00.000Z')
      expect(endOfDay('2026-10-25').toISOString()).toBe('2026-10-25T21:59:59.999Z')
    })

    it('перша й остання мілісекунда входять, на мілісекунду раніше чи пізніше ні', async () => {
      const m = await manager()
      const first = await order({ manager: String(m.id), stockPostedAt: SEPTEMBER.from, revenueBani: 100 })
      const last = await order({ manager: String(m.id), stockPostedAt: SEPTEMBER.to, revenueBani: 100 })
      await order({ manager: String(m.id), stockPostedAt: new Date(SEPTEMBER.from.getTime() - 1), revenueBani: 100 })
      await order({ manager: String(m.id), stockPostedAt: new Date(SEPTEMBER.to.getTime() + 1), revenueBani: 100 })

      expect(await select(m)).toEqual(sorted(first, last))
    })
  })

  describe('selectPayrollOrders', () => {
    it('не враховує скасовані, непроведені й поза періодом', async () => {
      const m = await manager()
      const counted = await order({ manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })
      await order({ manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100, status: 'cancelled' })
      await order({ manager: String(m.id), stockPostedAt: null, revenueBani: 100 })
      await order({ manager: String(m.id), stockPostedAt: new Date('2026-10-10T09:00:00.000Z'), revenueBani: 100 })

      expect(await select(m)).toEqual([counted])
    })

    it('snapshot vs current: клієнту змінили менеджера — snapshot лишає старого, current бере нового', async () => {
      const [m1, m2] = [await manager(), await manager()]
      const customer = await makeUser(payload, data, ['customer'], { manager: String(m1.id) })
      const sale = await order({ manager: String(m1.id), customer: String(customer.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })

      expect(await select(m1, { attribution: 'snapshot' })).toEqual([sale])
      expect(await select(m1, { attribution: 'current' })).toEqual([sale])

      await payload.update({ collection: 'users', id: customer.id, data: { manager: String(m2.id) } as never })

      expect(await select(m1, { attribution: 'snapshot' })).toEqual([sale])
      expect(await select(m1, { attribution: 'current' })).toEqual([])
      expect(await select(m2, { attribution: 'current' })).toEqual([sale])
      expect(await select(m2, { attribution: 'snapshot' })).toEqual([])
    })

    it('current: гостьові замовлення не враховуються, snapshot їх бере', async () => {
      const m = await manager()
      const guest = await order({ manager: String(m.id), customer: null, stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })

      expect(await select(m, { attribution: 'snapshot' })).toEqual([guest])
      expect(await select(m, { attribution: 'current' })).toEqual([])
    })

    it('customerFilter: all, retail (з гостями), wholesale — за поточною ознакою Users.wholesale', async () => {
      const m = await manager()
      const retailCustomer = await makeUser(payload, data, ['customer'])
      const wholesaleCustomer = await makeUser(payload, data, ['customer'], { wholesale: true })
      const retail = await order({ manager: String(m.id), customer: String(retailCustomer.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })
      const wholesale = await order({ manager: String(m.id), customer: String(wholesaleCustomer.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })
      const guest = await order({ manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })

      expect(await select(m, { customerFilter: 'all' })).toEqual(sorted(retail, wholesale, guest))
      expect(await select(m, { customerFilter: 'retail' })).toEqual(sorted(retail, guest))
      expect(await select(m, { customerFilter: 'wholesale' })).toEqual([wholesale])
    })

    it('customerFilter разом з current: оптовик менеджера', async () => {
      const m = await manager()
      const wholesaleCustomer = await makeUser(payload, data, ['customer'], { wholesale: true, manager: String(m.id) })
      const retailCustomer = await makeUser(payload, data, ['customer'], { manager: String(m.id) })
      const wholesale = await order({ customer: String(wholesaleCustomer.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })
      const retail = await order({ customer: String(retailCustomer.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 100 })

      expect(await select(m, { attribution: 'current', customerFilter: 'wholesale' })).toEqual([wholesale])
      expect(await select(m, { attribution: 'current', customerFilter: 'retail' })).toEqual([retail])
    })

    it('payment_date: за останньою оплатою; дві частини, оплата після періоду, сторнована оплата', async () => {
      const m = await manager()
      const base = { manager: String(m.id), stockPostedAt: new Date('2026-08-20T09:00:00.000Z'), revenueBani: 10000 }

      // Дві частини: серпень і вересень → останню оплату у вересні.
      const twoParts = await order(base)
      await receipt(twoParts, 4000, '2026-08-25T00:00:00.000Z')
      await receipt(twoParts, 6000, '2026-09-05T00:00:00.000Z')

      // Друга частина в жовтні → не вересень, а жовтень.
      const paidInOctober = await order(base)
      await receipt(paidInOctober, 5000, '2026-09-03T00:00:00.000Z')
      await receipt(paidInOctober, 5000, '2026-10-02T00:00:00.000Z')

      // Оплачено у вересні, але оплату сторновано → замовлення вже не paid.
      const reversed = await order(base)
      const full = await receipt(reversed, 10000, '2026-09-10T00:00:00.000Z')
      await payload.update({
        collection: 'cash-operations',
        id: full.id,
        data: { status: 'reversed', reversalReason: 'test' },
        user: admin,
        overrideAccess: false,
      })

      // Частково оплачене у вересні не враховується.
      const partial = await order(base)
      await receipt(partial, 3000, '2026-09-12T00:00:00.000Z')

      expect(await select(m, { dateBasis: 'payment_date' })).toEqual([twoParts])
      expect(await select(m, { dateBasis: 'payment_date' }, periodBounds('2026-10-01', '2026-10-31'))).toEqual([paidInOctober])
      // order_date бере всі проведені в серпні, незалежно від оплати.
      expect(await select(m, { dateBasis: 'order_date' }, periodBounds('2026-08-01', '2026-08-31'))).toEqual(
        sorted(twoParts, paidInOctober, reversed, partial),
      )
    })

    it('вибірка + розрахунок: кожна база на тих самих замовленнях', async () => {
      const m = await manager()
      await order({ manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 10000, cogsBani: 7000, paymentState: 'paid' })
      await order({ manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani: 20000, cogsBani: 12000 })
      const rows = await selectPayrollOrders(req, { manager: String(m.id), ...SEPTEMBER, scheme: DEFAULT_SCHEME })
      const total = (base: 'revenue' | 'gross_profit' | 'paid_revenue') =>
        calculatePayroll({ scheme: { percentBp: 1000, base }, orders: rows }).percentAmountBani

      expect(total('revenue')).toBe(3000)
      expect(total('gross_profit')).toBe(1100)
      expect(total('paid_revenue')).toBe(1000)
    })
  })

  describe('схеми зарплати', () => {
    it('paid_revenue з order_date відхиляється, з payment_date проходить', async () => {
      const m = await manager()
      await rejectsWith(
        scheme({ manager: String(m.id), base: 'paid_revenue', dateBasis: 'order_date', validFrom: '2030-01-01T00:00:00.000Z' }),
        'custom:error:salarySchemePaidRevenueDate',
      )
      await expect(
        scheme({ manager: String(m.id), base: 'paid_revenue', dateBasis: 'payment_date', validFrom: '2030-01-01T00:00:00.000Z' }),
      ).resolves.toBeTruthy()
    })

    it('validTo раніше validFrom відхиляється; відсоток лише ціле 0..10000', async () => {
      const m = await manager()
      await rejectsWith(
        scheme({ manager: String(m.id), validFrom: '2030-02-01T00:00:00.000Z', validTo: '2030-01-31T00:00:00.000Z' }),
        'custom:error:salarySchemeValidTo',
      )
      await expect(scheme({ manager: String(m.id), percentBp: 10001 })).rejects.toThrow()
      await expect(scheme({ manager: String(m.id), percentBp: 12.5 })).rejects.toThrow()
    })

    it('manager схеми має бути з роллю manager', async () => {
      const customer = await makeUser(payload, data, ['customer'])
      await expect(scheme({ manager: String(customer.id) })).rejects.toThrow()
    })

    it('схеми одного менеджера не перетинаються; суміжні й інших менеджерів проходять', async () => {
      const [m1, m2] = [await manager(), await manager()]
      await scheme({ manager: String(m1.id), validFrom: '2030-01-01T00:00:00.000Z', validTo: '2030-06-30T00:00:00.000Z' })

      await rejectsWith(
        scheme({ manager: String(m1.id), validFrom: '2030-06-30T00:00:00.000Z', validTo: '2030-12-31T00:00:00.000Z' }),
        'custom:error:salarySchemeOverlap',
      )
      // Порожній validTo = безстроково: перетинає все пізніше.
      await rejectsWith(scheme({ manager: String(m1.id), validFrom: '2029-01-01T00:00:00.000Z' }), 'custom:error:salarySchemeOverlap')
      await expect(
        scheme({ manager: String(m1.id), validFrom: '2030-07-01T00:00:00.000Z', validTo: '2030-12-31T00:00:00.000Z' }),
      ).resolves.toBeTruthy()
      await expect(
        scheme({ manager: String(m2.id), validFrom: '2030-01-01T00:00:00.000Z', validTo: '2030-06-30T00:00:00.000Z' }),
      ).resolves.toBeTruthy()
    })

    it('схеми за замовчуванням не перетинаються між собою', async () => {
      await scheme({ validFrom: '2041-01-01T00:00:00.000Z', validTo: '2041-12-31T00:00:00.000Z' })
      await rejectsWith(
        scheme({ validFrom: '2041-06-01T00:00:00.000Z', validTo: '2042-05-31T00:00:00.000Z' }),
        'custom:error:salarySchemeOverlap',
      )
    })

    it('pickScheme: схема менеджера має пріоритет, вибір за датою, інакше за замовчуванням, інакше помилка', async () => {
      const [m, other] = [await manager(), await manager()]
      const fallback = await scheme({ validFrom: '2040-01-01T00:00:00.000Z', validTo: '2040-12-31T00:00:00.000Z' })
      const firstHalf = await scheme({
        manager: String(m.id),
        validFrom: '2040-01-01T00:00:00.000Z',
        validTo: '2040-06-30T00:00:00.000Z',
      })
      const secondHalf = await scheme({ manager: String(m.id), validFrom: '2040-07-01T00:00:00.000Z' })

      expect((await pickScheme(req, String(m.id), '2040-03-15T00:00:00.000Z')).id).toBe(firstHalf)
      expect((await pickScheme(req, String(m.id), '2040-06-30T20:00:00.000Z')).id).toBe(firstHalf)
      expect((await pickScheme(req, String(m.id), '2040-07-01T00:00:00.000Z')).id).toBe(secondHalf)
      expect((await pickScheme(req, String(other.id), '2040-03-15T00:00:00.000Z')).id).toBe(fallback)
      await rejectsWith(pickScheme(req, String(other.id), '2045-03-15T00:00:00.000Z'), 'custom:error:salarySchemeNotFound')
    })
  })
})
