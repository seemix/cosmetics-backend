import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { debtsReport } from '@/endpoints/reports/debts'
import config from '@/payload.config'

import { at, callReport, nonIntegerBani, randomDay, type ReportBody, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload
let s: ReportScenario

const tag = `RDBT-${Date.now()}`
const day = randomDay()
const ids: Record<string, string> = {}

const debts = async (query: Record<string, string | number | boolean> = {}) => {
  const { status, body } = await callReport(payload, debtsReport, { limit: 200, ...query })
  expect(status).toBe(200)
  return body
}

/** Рядки секції лише для документів цього тесту (БД спільна). */
const mine = (section: { items: Array<Record<string, unknown>> }, key: string) =>
  Object.fromEntries(
    section.items.filter((item) => Object.values(ids).includes(String(item[key]))).map((item) => [String(item[key]), item]),
  )

describe('R1: звіт боргів', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()

    ids.supplier = await s.newSupplier('supplier')
    ids.carrier = await s.newSupplier('carrier')
    ids.reversedSupplier = await s.newSupplier('reversed')
    ids.settledSupplier = await s.newSupplier('settled')
    ids.manager = await s.newManager('Debt')
    ids.customer = await s.newCustomer()
    const product = await s.newProduct(100)
    const salary = await s.newCategory('salary', true)

    s.setNow(at(day, 8))
    await s.fund(10_000_000)
    // C4: накладна 2 327,20 + логістика 150,00 перевізнику, оплата 1 000,00 → 1 327,20 і 150,00.
    await s.purchase(ids.supplier, [{ product, quantity: 1, unitPriceBani: 232_720 }], {
      extraCosts: [{ amountBani: 15_000, payee: ids.carrier }],
    })
    await s.cash({ type: 'supplier_payment', supplier: ids.supplier, amountBani: 100_000 })
    // Сторнується наступного дня: на `day` ще борг.
    const reversed = await s.purchase(ids.reversedSupplier, [{ product, quantity: 1, unitPriceBani: 5000 }])
    // Нульовий борг: накладна повністю оплачена.
    await s.purchase(ids.settledSupplier, [{ product, quantity: 1, unitPriceBani: 7000 }])
    await s.cash({ type: 'supplier_payment', supplier: ids.settledSupplier, amountBani: 7000 })

    // M4: розрахунок 5 000,00, виплата 3 000,00 → 2 000,00.
    await s.scheme(ids.manager, {
      fixedBani: 500_000,
      validFrom: `${shiftDay(day, -40)}T00:00:00.000Z`,
      validTo: `${shiftDay(day, 40)}T00:00:00.000Z`,
    })
    const payroll = await s.payroll(ids.manager, `${shiftDay(day, -30)}T00:00:00.000Z`, `${shiftDay(day, -1)}T00:00:00.000Z`)
    expect(payroll.totalBani).toBe(500_000)
    await s.cash({ type: 'expense', category: salary, manager: ids.manager, payroll: String(payroll.id), amountBani: 300_000 })

    // C5: замовлення покупця 2 × 100 MDL, оплачено 50,00 → борг 150,00.
    s.setNow(at(day, 9))
    const order = await s.order([{ product, quantity: 2 }], { customer: ids.customer })
    ids.order = String(order.id)
    await s.cash({ type: 'customer_receipt', order: order.id, amountBani: 5000 })

    s.setNow(at(shiftDay(day, 1), 9))
    await s.reverse('purchases', String(reversed.id))
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('постачальники на asOf: приклад C4, перевізник, сторно після asOf ще враховується', async () => {
    const body = await debts({ asOf: day })
    const suppliers = mine(body.suppliers, 'supplier')

    expect(body).toMatchObject({ currency: 'MDL', unit: 'bani', asOf: day, customersAsOf: 'current' })
    expect(suppliers[ids.supplier]).toEqual({
      supplier: ids.supplier,
      name: `${tag} supplier`,
      goodsBani: 232_720,
      extraBani: 0,
      openingBani: 0,
      paidBani: 100_000,
      weOweBani: 132_720,
    })
    expect(suppliers[ids.carrier]).toMatchObject({ extraBani: 15_000, weOweBani: 15_000 })
    expect(suppliers[ids.reversedSupplier]).toMatchObject({ weOweBani: 5000 })
    expect(body.suppliers.totalBani).toBe(body.suppliers.items.reduce((sum: number, item: { weOweBani: number }) => sum + item.weOweBani, 0))
  })

  it('після сторно накладна не враховується; нульові борги приховані, includeZero їх показує', async () => {
    const after = mine((await debts({ asOf: shiftDay(day, 1) })).suppliers, 'supplier')
    expect(after[ids.reversedSupplier]).toBeUndefined()
    expect(after[ids.settledSupplier]).toBeUndefined()
    expect(after[ids.supplier]).toMatchObject({ weOweBani: 132_720 })

    const withZero = mine((await debts({ asOf: shiftDay(day, 1), includeZero: true })).suppliers, 'supplier')
    // C4 повертає лише постачальників з обліковими документами на asOf: сторнований повністю зникає.
    expect(withZero[ids.reversedSupplier]).toBeUndefined()
    expect(withZero[ids.settledSupplier]).toMatchObject({ goodsBani: 7000, paidBani: 7000, weOweBani: 0 })
  })

  it('до проведення документів боргу ще немає', async () => {
    const before = await debts({ asOf: shiftDay(day, -1) })

    expect(mine(before.suppliers, 'supplier')).toEqual({})
    expect(mine(before.managers, 'manager')).toEqual({})
  })

  it('менеджер: payroll 5 000,00 − виплати 3 000,00 = 2 000,00', async () => {
    const managers = mine((await debts({ asOf: day })).managers, 'manager')

    expect(managers[ids.manager]).toEqual({
      manager: ids.manager,
      name: 'Debt User',
      accruedBani: 500_000,
      paidBani: 300_000,
      weOweBani: 200_000,
    })
  })

  it('покупці: поточний стан незалежно від asOf, з замовленнями', async () => {
    for (const asOf of [day, shiftDay(day, -1)]) {
      const body: ReportBody = await debts({ asOf })
      const customers = mine(body.customers, 'customer')

      expect(customers[ids.customer]).toMatchObject({
        customer: ids.customer,
        name: 'Test User',
        email: expect.stringMatching(/@example\.test$/),
        ordersCount: 1,
        owedToUsBani: 15_000,
      })
      expect(customers[ids.customer].orders).toEqual([
        { order: ids.order, number: expect.any(String), capBani: 20_000, paidBani: 5000, owedToUsBani: 15_000 },
      ])
      expect(body.customers.totalBani).toBeGreaterThanOrEqual(15_000)
      expect(body.customers.pagination.total).toBeGreaterThanOrEqual(1)
      expect(nonIntegerBani(body)).toEqual([])
    }
  })

  it('пагінація покупців: totalBani за всіма сторінками, сторінки не перетинаються', async () => {
    const all = await debts()
    const first = await debts({ limit: 1 })
    const second = await debts({ limit: 1, page: 2 })

    expect(first.customers.items).toHaveLength(1)
    expect(first.customers.totalBani).toBe(all.customers.totalBani)
    expect(first.customers.pagination).toEqual({ page: 1, limit: 1, total: all.customers.pagination.total })
    if (all.customers.pagination.total > 1) {
      expect(second.customers.items[0].customer).not.toBe(first.customers.items[0].customer)
    }
    expect(all.customers.totalBani).toBe(
      all.customers.items.reduce((sum: number, item: { owedToUsBani: number }) => sum + item.owedToUsBani, 0),
    )
  })

  it('неправильний asOf: 400', async () => {
    const { status, body } = await callReport(payload, debtsReport, { asOf: '2020-13-01', includeZero: 'yes' })

    expect(status).toBe(400)
    expect(body.fields).toEqual([
      { field: 'asOf', reason: 'format' },
      { field: 'includeZero', reason: 'format' },
    ])
  })
})
