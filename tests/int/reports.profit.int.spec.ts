import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { profitReport } from '@/endpoints/reports/profit'
import config from '@/payload.config'

import { at, callReport, type ReportBody, firstMs, lastMs, nonIntegerBani, randomDay, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload
let s: ReportScenario

const tag = `RPRF-${Date.now()}`
// Кожен сценарій у своєму дні: base, base+3, base+6, … (сусідні дні вільні для перевірки меж).
const base = randomDay()
let slot = 0
const nextDay = () => shiftDay(base, 3 * ++slot)

const profit = async (from: string, to = from) => {
  const { status, body } = await callReport(payload, profitReport, { from, to })
  expect(status).toBe(200)
  return body
}

describe('R1: звіт прибутку', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()
  })

  afterAll(async () => {
    await s.cleanup()
  })

  describe('еталон розд. 12: 50 000 − 31 200 − 450 − 10 300 = 8 050,00', () => {
    const day = nextDay()
    let body: ReportBody
    let rent: string
    let hosting: string
    let salary: string

    beforeAll(async () => {
      s.setNow(at(day, 9))
      const supplier = await s.newSupplier()
      const goods = await s.newProduct(100)
      const tester = await s.newProduct(100)
      // Середня P = 62,40; T = 45,00.
      await s.purchase(supplier, [
        { product: goods, quantity: 600, unitPriceBani: 6240 },
        { product: tester, quantity: 10, unitPriceBani: 4500 },
      ])

      s.setNow(at(day, 10))
      // 500 × 100 MDL = 50 000,00 виручки; собівартість 500 × 62,40 = 31 200,00.
      const order = await s.order([{ product: goods, quantity: 500 }])
      expect(order.accounting?.revenueBani).toBe(5_000_000)
      expect(order.accounting?.cogsBani).toBe(3_120_000)
      // Оплата покупця дає касі гроші на витрати, але в прибуток не входить.
      await s.cash({ type: 'customer_receipt', order: order.id, amountBani: 5_000_000 })

      s.setNow(at(day, 11))
      await s.adjustment('writeoff', [{ product: tester, quantity: 10 }])

      s.setNow(at(day, 12))
      rent = await s.newCategory('rent')
      hosting = await s.newCategory('hosting')
      salary = await s.newCategory('salary', true)
      const manager = await s.newManager()
      await s.cash({ type: 'expense', category: rent, amountBani: 600_000 })
      await s.cash({ type: 'expense', category: hosting, amountBani: 30_000 })
      await s.cash({ type: 'expense', category: salary, manager, amountBani: 400_000 })
      // Не витрати: оплата постачальнику й переказ між касами.
      await s.cash({ type: 'supplier_payment', supplier, amountBani: 100_000 })
      await s.cash({ type: 'transfer', toAccount: await s.newAccount('bank'), amountBani: 50_000 })

      body = await profit(day)
    })

    it('підсумки збігаються з прикладом дизайну', () => {
      expect(body).toMatchObject({
        currency: 'MDL',
        unit: 'bani',
        period: { from: day, to: day },
        revenueBani: 5_000_000,
        cogsBani: 3_120_000,
        grossProfitBani: 1_880_000,
        warehouseLossesBani: 45_000,
        expensesBani: 1_030_000,
        salaryExpensesBani: 400_000,
        profitBani: 805_000,
        ordersCount: 1,
        method: { revenue: 'by_order_date', expenses: 'cash' },
      })
    })

    it('розбивка витрат по статтях: сума, isSalary, кількість', () => {
      expect(body.expensesByCategory).toEqual([
        { category: rent, code: `${tag}-rent`, name: `${tag} rent`, isSalary: false, totalBani: 600_000, count: 1 },
        { category: salary, code: `${tag}-salary`, name: `${tag} salary`, isSalary: true, totalBani: 400_000, count: 1 },
        { category: hosting, code: `${tag}-hosting`, name: `${tag} hosting`, isSalary: false, totalBani: 30_000, count: 1 },
      ])
    })

    it('усі суми цілі бані', () => {
      expect(nonIntegerBani(body)).toEqual([])
    })
  })

  describe('виручка й собівартість', () => {
    it('скасоване в періоді не враховується, скасоване після end враховується', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      s.setNow(at(day, 8))
      await s.purchase(await s.newSupplier(), [{ product, quantity: 10, unitPriceBani: 500 }])

      s.setNow(at(day, 9))
      const cancelledSameDay = await s.order([{ product, quantity: 1 }])
      const cancelledNextDay = await s.order([{ product, quantity: 2 }])
      s.setNow(at(day, 15))
      await s.cancel(cancelledSameDay)
      s.setNow(at(shiftDay(day, 1), 9))
      await s.cancel(cancelledNextDay)

      // На кінець дня друге ще не скасоване: 2 × 10 MDL, собівартість 2 × 5,00.
      expect(await profit(day)).toMatchObject({ revenueBani: 2000, cogsBani: 1000, ordersCount: 1 })
      // Період, що включає день скасування: обидва скасовані на end.
      expect(await profit(day, shiftDay(day, 1))).toMatchObject({ revenueBani: 0, cogsBani: 0, ordersCount: 0 })
    })

    it('замовлення поза періодом і історичне (без stockPostedAt) не враховуються', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      s.setNow(at(shiftDay(day, -1), 8))
      await s.purchase(await s.newSupplier(), [{ product, quantity: 10, unitPriceBani: 500 }])
      await s.order([{ product, quantity: 1 }])

      s.setNow(at(day, 9))
      await s.settings({ stockControlEnabled: false })
      try {
        const historical = await s.order([{ product, quantity: 3 }])
        expect(historical.accounting?.stockPostedAt ?? null).toBeNull()
      } finally {
        await s.settings({ stockControlEnabled: true })
      }

      expect(await profit(day)).toMatchObject({ revenueBani: 0, cogsBani: 0, ordersCount: 0 })
      expect(await profit(shiftDay(day, -1))).toMatchObject({ revenueBani: 1000, ordersCount: 1 })
    })

    it('межі дня в поясі магазину: перша й остання мілісекунда входять, сусідні ні', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      s.setNow(at(shiftDay(day, -1), 1))
      await s.purchase(await s.newSupplier(), [{ product, quantity: 10, unitPriceBani: 500 }])

      // 1 шт. в останню мс попереднього дня, 2 у першу мс дня, 3 в останню мс дня, 4 у першу мс наступного.
      const quantities: Array<[Date, number]> = [
        [lastMs(shiftDay(day, -1)), 1],
        [firstMs(day), 2],
        [lastMs(day), 3],
        [firstMs(shiftDay(day, 1)), 4],
      ]
      for (const [instant, quantity] of quantities) {
        s.setNow(instant)
        await s.order([{ product, quantity }])
      }

      expect(await profit(day)).toMatchObject({ revenueBani: 5000, ordersCount: 2 })
      expect(firstMs(day).getTime() - lastMs(shiftDay(day, -1)).getTime()).toBe(1)
    })
  })

  describe('втрати складу', () => {
    it('списання, сторноване в періоді, нейтралізується; сторно після end ще враховується', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      s.setNow(at(day, 8))
      await s.purchase(await s.newSupplier(), [{ product, quantity: 10, unitPriceBani: 700 }])

      s.setNow(at(day, 9))
      const reversedSameDay = await s.adjustment('writeoff', [{ product, quantity: 1 }])
      const reversedNextDay = await s.adjustment('writeoff', [{ product, quantity: 2 }])
      s.setNow(at(day, 10))
      await s.reverse('stock-adjustments', String(reversedSameDay.id))
      s.setNow(at(shiftDay(day, 1), 10))
      await s.reverse('stock-adjustments', String(reversedNextDay.id))

      expect(await profit(day)).toMatchObject({ warehouseLossesBani: 1400, profitBani: -1400 })
      expect(await profit(day, shiftDay(day, 1))).toMatchObject({ warehouseLossesBani: 0 })
      // Сторно відліковується датою руху: окремо наступний день дає «від'ємні втрати».
      expect(await profit(shiftDay(day, 1))).toMatchObject({ warehouseLossesBani: -1400, profitBani: 1400 })
    })

    it('надлишок інвентаризації зменшує втрати', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      const other = await s.newProduct(10)
      s.setNow(at(day, 8))
      await s.purchase(await s.newSupplier(), [
        { product, quantity: 10, unitPriceBani: 1000 },
        { product: other, quantity: 10, unitPriceBani: 300 },
      ])

      s.setNow(at(day, 9))
      // Нестача 2 × 10,00 = 20,00; надлишок 1 × 3,00.
      await s.adjustment('inventory', [
        { product, countedQty: 8 },
        { product: other, countedQty: 11 },
      ])

      expect(await profit(day)).toMatchObject({ warehouseLossesBani: 1700 })
    })

    it('сторнована закупівля, переміщення й чернетки не потрапляють у втрати', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      const shop = await s.newWarehouse(`shop-${day}`)
      const supplier = await s.newSupplier()
      s.setNow(at(day, 8))
      await s.purchase(supplier, [{ product, quantity: 10, unitPriceBani: 1000 }])
      const reversed = await s.purchase(supplier, [{ product, quantity: 5, unitPriceBani: 1000 }])
      s.setNow(at(day, 9))
      await s.reverse('purchases', String(reversed.id))
      await s.transfer(product, 3, shop)
      await s.adjustment('writeoff', [{ product, quantity: 1 }], { post: false })

      expect(await profit(day)).toMatchObject({ warehouseLossesBani: 0, profitBani: 0 })
    })
  })

  describe('витрати', () => {
    it('сторнована до end не враховується, після end враховується; чернетка ніколи', async () => {
      const day = nextDay()
      const category = await s.newCategory(`misc-${day}`)
      s.setNow(at(day, 8))
      await s.fund(100_000)

      s.setNow(at(day, 9))
      const reversedSameDay = await s.cash({ type: 'expense', category, amountBani: 1000 })
      const reversedNextDay = await s.cash({ type: 'expense', category, amountBani: 2000 })
      await s.cash({ type: 'expense', category, amountBani: 4000 }, { post: false })
      s.setNow(at(day, 10))
      await s.reverse('cash-operations', String(reversedSameDay.id))
      s.setNow(at(shiftDay(day, 1), 10))
      await s.reverse('cash-operations', String(reversedNextDay.id))

      expect(await profit(day)).toMatchObject({ expensesBani: 2000, profitBani: -2000 })
      expect(await profit(day, shiftDay(day, 1))).toMatchObject({ expensesBani: 0, expensesByCategory: [] })
    })

    it('supplier_payment, transfer, customer_receipt і customer_refund не входять до витрат і прибутку', async () => {
      const day = nextDay()
      const product = await s.newProduct(10)
      const supplier = await s.newSupplier()
      s.setNow(at(day, 8))
      await s.fund(100_000)
      await s.purchase(supplier, [{ product, quantity: 5, unitPriceBani: 500 }])
      await s.cash({ type: 'supplier_payment', supplier, amountBani: 2500 })
      await s.cash({ type: 'transfer', toAccount: await s.newAccount(`bank-${day}`), amountBani: 1000 })

      s.setNow(at(shiftDay(day, 1), 9))
      const order = await s.order([{ product, quantity: 1 }])
      await s.cash({ type: 'customer_receipt', order: order.id, amountBani: 1000 })
      await s.cash({ type: 'customer_refund', order: order.id, amountBani: 400 })

      expect(await profit(day)).toMatchObject({ expensesBani: 0, profitBani: 0 })
      expect(await profit(shiftDay(day, 1))).toMatchObject({ expensesBani: 0, revenueBani: 1000, profitBani: 500 })
    })
  })

  describe('попередження', () => {
    it('період до accountingStartAt і облік не запущено', async () => {
      const day = nextDay()

      await s.settings({ accountingStartAt: at(day, 12).toISOString() })
      expect((await profit(day)).warnings).toEqual([
        { code: 'PERIOD_BEFORE_ACCOUNTING_START', accountingStartAt: at(day, 12).toISOString() },
      ])
      expect((await profit(shiftDay(day, 1))).warnings).toEqual([])

      await s.settings({ accountingStartAt: null })
      expect((await profit(day)).warnings).toEqual([{ code: 'ACCOUNTING_NOT_STARTED' }])
    })
  })
})
