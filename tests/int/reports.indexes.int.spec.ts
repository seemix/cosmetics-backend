import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { reportEndpoints } from '@/endpoints/reports'
import { expensesReport } from '@/endpoints/reports/expenses'
import { profitReport } from '@/endpoints/reports/profit'
import config from '@/payload.config'
import { countedInPeriod } from '@/services/reports/common'
import { expensesInPeriod, salesInPeriod, warehouseLossesInPeriod } from '@/services/reports/profit.service'
import { payrollsInPeriod } from '@/services/reports/salary.service'
import { periodBounds } from '@/utilities/period'

import { at, callReport, randomDay, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload

const tag = `RIDX-${Date.now()}`
const COUNT = 600
const day = randomDay()
const { from: start, to: end } = periodBounds(day, shiftDay(day, 30))

/** Згенеровані напряму документи: лише поля, потрібні для `$match`, і унікальні номери. */
const generated: Record<string, (i: number, date: Date) => Record<string, unknown>> = {
  orders: (i, date) => ({
    orderNumber: `${tag}-${i}`,
    status: 'pending',
    accounting: { stockPostedAt: date, revenueBani: 100, cogsBani: 50, cancelledAt: null },
  }),
  'stock-moves': (i, date) => ({
    date,
    docCollection: i % 3 === 0 ? 'stock-adjustments' : 'orders',
    docId: `${tag}-${i}`,
    qtyDelta: -1,
    valueDeltaBani: -10,
    moveType: 'writeoff',
  }),
  'cash-operations': (i, date) => ({
    number: `${tag}-${i}`,
    type: i % 2 === 0 ? 'expense' : 'transfer',
    status: i % 5 === 0 ? 'reversed' : 'posted',
    reversedAt: i % 5 === 0 ? date : null,
    operationDate: date,
    amountBani: 100,
  }),
  purchases: (i, date) => ({
    number: `${tag}-${i}`,
    status: 'posted',
    postedAt: date,
    goodsTotalBani: 100,
    extraTotalBani: 0,
    landedTotalBani: 100,
  }),
  payrolls: (i, date) => ({ number: `${tag}-${i}`, status: 'posted', periodTo: date, totalBani: 100 }),
}

/** Головний `$match` кожного звіту, побудований тими самими функціями, що й у сервісах. */
const matches: Array<{ slug: string; match: Record<string, unknown>; index: Record<string, number> }> = [
  { slug: 'orders', match: salesInPeriod({ start, end }), index: { 'accounting.stockPostedAt': 1 } },
  { slug: 'stock-moves', match: warehouseLossesInPeriod({ start, end }), index: { docCollection: 1, date: 1 } },
  { slug: 'cash-operations', match: expensesInPeriod({ start, end }), index: { type: 1, status: 1, operationDate: 1 } },
  { slug: 'purchases', match: countedInPeriod('postedAt', { start, end }), index: { status: 1, postedAt: 1 } },
  { slug: 'payrolls', match: payrollsInPeriod({ start, end }), index: { status: 1, periodTo: 1 } },
]

const model = (slug: string) => payload.db.collections[slug]

/** keyPattern усіх IXSCAN дерева плану. */
const keyPatterns = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(keyPatterns)
  if (!node || typeof node !== 'object') return []
  const scan = node as { stage?: string; keyPattern?: unknown }
  const own = scan.stage === 'IXSCAN' ? [JSON.stringify(scan.keyPattern)] : []
  return [...own, ...Object.values(node).flatMap(keyPatterns)]
}

/** Усі назви етапів дерева плану (класичний і SBE-формат `queryPlan`). */
const stages = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(stages)
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, value]) => (key === 'stage' && typeof value === 'string' ? [value] : stages(value)))
}

describe('R1: індекси головних $match звітів', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    for (const [slug, make] of Object.entries(generated)) {
      // Індекси з конфігурації колекцій (зокрема нові з R1) мають бути збудовані до explain.
      await model(slug).createIndexes()
      const span = end.getTime() - start.getTime()
      // Половина документів поза періодом, щоб діапазон дати був вибірковим.
      const docs = Array.from({ length: COUNT }, (_, i) =>
        make(i, new Date(start.getTime() + ((i % 2 === 0 ? 0.5 : 3) * span * (i + 1)) / COUNT)),
      )
      await model(slug).collection.insertMany(docs as never[])
    }
  })

  afterAll(async () => {
    const byTag = { $regex: `^${tag}-` }
    await model('orders').collection.deleteMany({ orderNumber: byTag })
    await model('stock-moves').collection.deleteMany({ docId: byTag })
    for (const slug of ['cash-operations', 'purchases', 'payrolls']) await model(slug).collection.deleteMany({ number: byTag })
  })

  it.each(matches)('$slug: індекс існує, winning plan — IXSCAN цього індексу без COLLSCAN', async ({ slug, match, index }) => {
    const indexes = await model(slug).collection.indexes()
    expect(indexes.map((item) => JSON.stringify(item.key))).toContain(JSON.stringify(index))

    const explained = (await model(slug).collection.find(match).explain('queryPlanner')) as { queryPlanner: { winningPlan: unknown } }
    const plan = stages(explained.queryPlanner.winningPlan)

    expect(plan).toContain('IXSCAN')
    expect(plan).not.toContain('COLLSCAN')
    expect(keyPatterns(explained.queryPlanner.winningPlan)).toContain(JSON.stringify(index))
  })
})

describe('R1: звіти паралельно із записом документів', () => {
  let s: ReportScenario
  const writeDay = randomDay()

  beforeAll(async () => {
    s = new ReportScenario(payload, `${tag}-W`)
    await s.setup()
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('звіти під час проведення витрат не падають, а підсумок після запису точний', async () => {
    const category = await s.newCategory('misc')
    const accounts: string[] = []
    s.setNow(at(writeDay, 9))
    for (let i = 0; i < 5; i++) {
      // Окрема каса на кожну витрату: перевіряється паралельне читання, а не конфлікти запису однієї каси.
      accounts.push(await s.newAccount(`a${i}`))
      await s.fund(10_000, accounts[i])
    }

    const writes = accounts.map((account, i) => s.cash({ type: 'expense', category, account, amountBani: 1000 * (i + 1) }))
    const reads = Array.from({ length: 10 }, (_, i) =>
      callReport(payload, i % 2 ? expensesReport : profitReport, { from: writeDay, to: writeDay }),
    )
    const results = await Promise.all([...writes, ...reads])

    for (const read of results.slice(writes.length) as Array<{ status: number }>) expect(read.status).toBe(200)
    const { body } = await callReport(payload, expensesReport, { from: writeDay, to: writeDay })
    expect(body).toMatchObject({ totalBani: 15_000, count: 5 })
  })

  it('виклик усіх звітів нічого не змінює в БД', async () => {
    const slugs = ['orders', 'stock-moves', 'stock-balances', 'product-costs', 'purchases', 'cash-operations', 'cash-moves', 'cash-accounts', 'payrolls']
    const snapshot = async () =>
      Promise.all(
        slugs.map(async (slug) => {
          const [latest] = await model(slug).collection.find({}).sort({ updatedAt: -1 }).limit(1).toArray()
          return [slug, await model(slug).collection.countDocuments(), String(latest?.updatedAt ?? '')]
        }),
      )

    const before = await snapshot()
    for (const endpoint of reportEndpoints) {
      const { status } = await callReport(payload, endpoint, { from: writeDay, to: writeDay })
      expect(status).toBe(200)
    }
    expect(await snapshot()).toEqual(before)
  })
})
