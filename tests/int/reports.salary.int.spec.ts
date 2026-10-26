import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { salaryReport } from '@/endpoints/reports/salary'
import config from '@/payload.config'

import { at, callReport, nonIntegerBani, randomDay, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload
let s: ReportScenario

const tag = `RSAL-${Date.now()}`
// Період розрахунку: 10 днів від `from` до `to`.
const from = randomDay()
const to = shiftDay(from, 9)
const ids: Record<string, string> = {}
const midnight = (day: string) => `${day}T00:00:00.000Z`

const salary = async (query: Record<string, string> = {}) => {
  const { status, body } = await callReport(payload, salaryReport, { from, to, ...query })
  expect(status).toBe(200)
  return body
}

describe('R1: звіт зарплати', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()

    ids.alpha = await s.newManager('Alpha')
    ids.beta = await s.newManager('Beta')
    const alphaCustomer = await s.newCustomer(ids.alpha)
    const betaCustomer = await s.newCustomer(ids.beta)
    const product = await s.newProduct(100)
    const salaryCategory = await s.newCategory('salary', true)
    // Оклад 1 000,00 + 10 % виручки.
    for (const manager of [ids.alpha, ids.beta]) {
      await s.scheme(manager, {
        fixedBani: 100_000,
        percentBp: 1000,
        validFrom: midnight(shiftDay(from, -1)),
        validTo: midnight(shiftDay(to, 30)),
      })
    }

    s.setNow(at(from, 8))
    await s.fund(10_000_000)
    await s.purchase(await s.newSupplier(), [{ product, quantity: 20, unitPriceBani: 4000 }])

    s.setNow(at(from, 10))
    // Alpha: 200,00 + 100,00 виручки → 20,00 + 10,00 відсотка; Beta: 300,00 → 30,00.
    const kept = await s.order([{ product, quantity: 2 }], { customer: alphaCustomer })
    const toCancel = await s.order([{ product, quantity: 1 }], { customer: alphaCustomer })
    await s.order([{ product, quantity: 3 }], { customer: betaCustomer })
    ids.kept = String(kept.id)
    ids.cancelled = String(toCancel.id)
    ids.cancelledNumber = String(toCancel.orderNumber)

    s.setNow(at(to, 20))
    const alphaPayroll = await s.payroll(ids.alpha, midnight(from), midnight(to))
    const betaPayroll = await s.payroll(ids.beta, midnight(from), midnight(to))
    expect([alphaPayroll.totalBani, betaPayroll.totalBani]).toEqual([103_000, 103_000])
    ids.alphaPayroll = String(alphaPayroll.id)
    ids.alphaPayrollNumber = String(alphaPayroll.number)
    await s.cash({ type: 'expense', category: salaryCategory, manager: ids.alpha, payroll: ids.alphaPayroll, amountBani: 50_000 })

    // Після затвердження: скасування замовлення Alpha й виплата Beta поза періодом.
    s.setNow(at(shiftDay(to, 1), 10))
    await s.cancel(toCancel)
    s.setNow(at(shiftDay(to, 5), 10))
    await s.cash({ type: 'expense', category: salaryCategory, manager: ids.beta, payroll: String(betaPayroll.id), amountBani: 20_000 })
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('по менеджерах: нараховано, виплачено в періоді, борг на кінець, розрахунки', async () => {
    const body = await salary()

    expect(body).toMatchObject({ currency: 'MDL', unit: 'bani', period: { from, to } })
    expect(body.managers.map((row: { manager: string }) => row.manager)).toEqual([ids.alpha, ids.beta])
    expect(body.managers[0]).toMatchObject({
      name: 'Alpha User',
      accruedBani: 103_000,
      paidInPeriodBani: 50_000,
      debtBani: 53_000,
    })
    expect(body.managers[0].payrolls).toEqual([
      {
        id: ids.alphaPayroll,
        number: ids.alphaPayrollNumber,
        periodFrom: new Date(midnight(from)).toISOString(),
        periodTo: new Date(midnight(to)).toISOString(),
        totalBani: 103_000,
        paidBani: 50_000,
        status: 'posted',
      },
    ])
    expect(body.managers[1]).toMatchObject({ name: 'Beta User', accruedBani: 103_000, paidInPeriodBani: 0, debtBani: 103_000 })
    expect(body.totals).toEqual({ accruedBani: 206_000, paidInPeriodBani: 50_000, debtBani: 156_000 })
    expect(nonIntegerBani(body)).toEqual([])
  })

  it('cancelledAfterPayroll: скасоване після затвердження знайдено, нескасоване ні', async () => {
    const { cancelledAfterPayroll } = await salary()

    expect(cancelledAfterPayroll).toEqual({
      items: [
        {
          order: ids.cancelled,
          number: ids.cancelledNumber,
          payroll: ids.alphaPayroll,
          payrollNumber: ids.alphaPayrollNumber,
          manager: ids.alpha,
          managerName: 'Alpha User',
          amountBani: 1000,
        },
      ],
      totalBani: 1000,
    })
    expect(cancelledAfterPayroll.items.map((item: { order: string }) => item.order)).not.toContain(ids.kept)
  })

  it('фільтр менеджера: чужі менеджери не потрапляють', async () => {
    const body = await salary({ manager: ids.beta })

    expect(body.managers.map((row: { manager: string }) => row.manager)).toEqual([ids.beta])
    expect(body.totals).toEqual({ accruedBani: 103_000, paidInPeriodBani: 0, debtBani: 103_000 })
    expect(body.cancelledAfterPayroll).toEqual({ items: [], totalBani: 0 })
  })

  it('період за periodTo: наступний період не бачить розрахунків, але бачить виплату й борг', async () => {
    const body = await salary({ from: shiftDay(to, 1), to: shiftDay(to, 10) })
    const beta = body.managers.find((row: { manager: string }) => row.manager === ids.beta)
    const alpha = body.managers.find((row: { manager: string }) => row.manager === ids.alpha)

    expect(beta).toMatchObject({ accruedBani: 0, paidInPeriodBani: 20_000, debtBani: 83_000, payrolls: [] })
    // Alpha без руху в періоді, але з боргом.
    expect(alpha).toMatchObject({ accruedBani: 0, paidInPeriodBani: 0, debtBani: 53_000 })
    expect(body.cancelledAfterPayroll.items).toEqual([])
  })

  it('id не менеджера: 400 not_found', async () => {
    const customer = await s.newCustomer()
    const { status, body } = await callReport(payload, salaryReport, { from, to, manager: customer })

    expect(status).toBe(400)
    expect(body.fields).toEqual([{ field: 'manager', reason: 'not_found' }])
  })
})
