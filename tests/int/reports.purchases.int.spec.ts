import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { purchasesReport } from '@/endpoints/reports/purchases'
import config from '@/payload.config'

import { at, callReport, nonIntegerBani, randomDay, ReportScenario, shiftDay } from './helpers/reports'

let payload: Payload
let s: ReportScenario

const tag = `RPUR-${Date.now()}`
const day = randomDay()
let supplierA: string
let supplierB: string
const ids: Record<string, string> = {}

type Sums = { goodsTotalBani: number; extraTotalBani: number; landedTotalBani: number; count: number }

const purchases = async (query: Record<string, string | number> = {}) => {
  const { status, body } = await callReport(payload, purchasesReport, { from: day, to: day, ...query })
  expect(status).toBe(200)
  return body
}

const sum = (rows: Sums[]) =>
  rows.reduce(
    (total, row) => ({
      goodsTotalBani: total.goodsTotalBani + row.goodsTotalBani,
      extraTotalBani: total.extraTotalBani + row.extraTotalBani,
      landedTotalBani: total.landedTotalBani + row.landedTotalBani,
      count: total.count + row.count,
    }),
    { goodsTotalBani: 0, extraTotalBani: 0, landedTotalBani: 0, count: 0 },
  )

describe('R1: звіт закупівель', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()

    supplierA = await s.newSupplier('A')
    supplierB = await s.newSupplier('B')
    const carrier = await s.newSupplier('carrier')
    const product = await s.newProduct(100)

    s.setNow(at(shiftDay(day, -1), 12))
    await s.purchase(supplierA, [{ product, quantity: 1, unitPriceBani: 1000 }])

    s.setNow(at(day, 9))
    ids.a1 = String(
      (
        await s.purchase(supplierA, [{ product, quantity: 10, unitPriceBani: 1000 }], {
          extraCosts: [{ amountBani: 500, payee: carrier }],
        })
      ).id,
    )
    s.setNow(at(day, 10))
    ids.b1 = String((await s.purchase(supplierB, [{ product, quantity: 5, unitPriceBani: 2000 }])).id)
    s.setNow(at(day, 11))
    ids.a2 = String((await s.purchase(supplierA, [{ product, quantity: 3, unitPriceBani: 1000 }])).id)
    s.setNow(at(day, 12))
    const reversedSameDay = await s.purchase(supplierB, [{ product, quantity: 2, unitPriceBani: 1000 }])
    await s.purchase(supplierB, [{ product, quantity: 7, unitPriceBani: 1000 }], { post: false })
    s.setNow(at(day, 13))
    await s.reverse('purchases', String(reversedSameDay.id))
    // a2 сторнується наступного дня: на кінець `day` ще проведена.
    s.setNow(at(shiftDay(day, 1), 10))
    await s.reverse('purchases', ids.a2)
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('totals і bySupplier з полів накладних; Σ bySupplier = totals', async () => {
    const body = await purchases()

    expect(body.totals).toEqual({ goodsTotalBani: 23_000, extraTotalBani: 500, landedTotalBani: 23_500, count: 3 })
    expect(body.bySupplier).toEqual([
      { supplier: supplierA, name: `${tag} A`, goodsTotalBani: 13_000, extraTotalBani: 500, landedTotalBani: 13_500, count: 2 },
      { supplier: supplierB, name: `${tag} B`, goodsTotalBani: 10_000, extraTotalBani: 0, landedTotalBani: 10_000, count: 1 },
    ])
    expect(sum(body.bySupplier)).toEqual(body.totals)
    expect(nonIntegerBani(body)).toEqual([])
  })

  it('список накладних за postedAt спадаючи, з постачальником і складом', async () => {
    const body = await purchases()

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([ids.a2, ids.b1, ids.a1])
    expect(body.items[0]).toMatchObject({
      status: 'reversed',
      supplier: { id: supplierA, name: `${tag} A` },
      warehouse: { id: s.warehouse, name: `${tag} main`, code: `${tag}-main` },
      postedAt: at(day, 11).toISOString(),
      reversedAt: at(shiftDay(day, 1), 10).toISOString(),
      goodsTotalBani: 3000,
      extraTotalBani: 0,
      landedTotalBani: 3000,
    })
    expect(body.items[0].number).toMatch(/^PUR-\d{6}$/)
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 3 })
  })

  it('сторно в межах періоду виключає накладну', async () => {
    const body = await purchases({ to: shiftDay(day, 1) })

    expect(body.totals).toEqual({ goodsTotalBani: 20_000, extraTotalBani: 500, landedTotalBani: 20_500, count: 2 })
  })

  it('фільтр постачальника і пагінація', async () => {
    const onlyB = await purchases({ supplier: supplierB })
    expect(onlyB.totals).toMatchObject({ landedTotalBani: 10_000, count: 1 })
    expect(onlyB.bySupplier.map((row: { supplier: string }) => row.supplier)).toEqual([supplierB])

    const page = await purchases({ page: 2, limit: 1 })
    expect(page.items.map((item: { id: string }) => item.id)).toEqual([ids.b1])
    expect(page.pagination).toEqual({ page: 2, limit: 1, total: 3 })
    expect(page.totals.count).toBe(3)
  })
})
