import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expensesReport } from '@/endpoints/reports/expenses'
import { profitReport } from '@/endpoints/reports/profit'
import config from '@/payload.config'

import { at, callReport, nonIntegerBani, randomDay, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload
let s: ReportScenario

const tag = `REXP-${Date.now()}`
const day = randomDay()
const nextDay = shiftDay(day, 1)
let rent: string
let salary: string
let manager: string
let bank: string
const ids: Record<string, string> = {}

const expenses = async (query: Record<string, string | number> = {}) => {
  const { status, body } = await callReport(payload, expensesReport, { from: day, to: nextDay, ...query })
  expect(status).toBe(200)
  return body
}

describe('R1: звіт витрат', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()

    rent = await s.newCategory('rent')
    salary = await s.newCategory('salary', true)
    manager = await s.newManager()
    bank = await s.newAccount('bank')

    s.setNow(at(day, 8))
    await s.fund(1_000_000)
    await s.fund(1_000_000, bank)

    s.setNow(at(day, 9))
    ids.rentCash = String((await s.cash({ type: 'expense', category: rent, amountBani: 10_000 })).id)
    s.setNow(at(day, 10))
    ids.rentBank = String((await s.cash({ type: 'expense', category: rent, amountBani: 25_050, account: bank })).id)
    s.setNow(at(nextDay, 9))
    ids.salary = String((await s.cash({ type: 'expense', category: salary, manager, amountBani: 40_000 })).id)
    // Не потрапляють у звіт: сторнована, чернетка, переказ.
    const reversed = await s.cash({ type: 'expense', category: rent, amountBani: 999 })
    await s.reverse('cash-operations', String(reversed.id))
    await s.cash({ type: 'expense', category: rent, amountBani: 777 }, { post: false })
    await s.cash({ type: 'transfer', toAccount: bank, amountBani: 5000 })
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('total, розбивки по статтях і касах сходяться; список за operationDate спадаючи', async () => {
    const body = await expenses()

    expect(body).toMatchObject({ currency: 'MDL', unit: 'bani', period: { from: day, to: nextDay }, totalBani: 75_050, count: 3 })
    expect(body.byCategory).toEqual([
      { category: salary, code: `${tag}-salary`, name: `${tag} salary`, isSalary: true, totalBani: 40_000, count: 1 },
      { category: rent, code: `${tag}-rent`, name: `${tag} rent`, isSalary: false, totalBani: 35_050, count: 2 },
    ])
    expect(body.byCategory.reduce((sum: number, row: { totalBani: number }) => sum + row.totalBani, 0)).toBe(body.totalBani)
    expect(body.byAccount).toEqual([
      { account: s.account, code: `${tag}-cash`, name: `${tag} cash`, totalBani: 50_000, count: 2 },
      { account: bank, code: `${tag}-bank`, name: `${tag} bank`, totalBani: 25_050, count: 1 },
    ])

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([ids.salary, ids.rentBank, ids.rentCash])
    expect(body.items[0]).toMatchObject({
      operationDate: at(nextDay, 9).toISOString(),
      category: { id: salary, code: `${tag}-salary`, name: `${tag} salary` },
      account: { id: s.account, name: `${tag} cash` },
      amountBani: 40_000,
      supplier: null,
      manager: { id: manager, name: 'Test User' },
    })
    expect(body.items[0].number).toMatch(/^CSH-\d{6}$/)
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 3 })
    expect(nonIntegerBani(body)).toEqual([])
  })

  it('збігається з витратами звіту прибутку', async () => {
    const { body } = await callReport(payload, profitReport, { from: day, to: nextDay })

    expect(body.expensesBani).toBe(75_050)
    expect(body.salaryExpensesBani).toBe(40_000)
  })

  it('фільтр статті й каси', async () => {
    expect(await expenses({ category: rent })).toMatchObject({ totalBani: 35_050, count: 2 })
    expect(await expenses({ account: bank })).toMatchObject({ totalBani: 25_050, count: 1 })
    const both = await expenses({ category: rent, account: s.account })
    expect(both).toMatchObject({ totalBani: 10_000, count: 1 })
    expect(both.items.map((item: { id: string }) => item.id)).toEqual([ids.rentCash])
  })

  it('пагінація: сторінка 2 по 2 і total за всіма сторінками', async () => {
    const body = await expenses({ page: 2, limit: 2 })

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([ids.rentCash])
    expect(body.pagination).toEqual({ page: 2, limit: 2, total: 3 })
    expect(body.totalBani).toBe(75_050)
  })

  it('невідома стаття: 400 not_found; не ObjectId: 400 format (існування тоді не перевіряється)', async () => {
    const missing = await callReport(payload, expensesReport, { from: day, to: nextDay, category: '0123456789abcdef01234567' })
    expect(missing.status).toBe(400)
    expect(missing.body).toMatchObject({ code: 'INVALID_PARAMS', fields: [{ field: 'category', reason: 'not_found' }] })

    const malformed = await callReport(payload, expensesReport, {
      from: day,
      to: nextDay,
      category: '0123456789abcdef01234567',
      account: 'not-an-id',
    })
    expect(malformed.status).toBe(400)
    expect(malformed.body.fields).toEqual([{ field: 'account', reason: 'format' }])
  })
})
