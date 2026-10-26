import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { stockReport } from '@/endpoints/reports/stock'
import config from '@/payload.config'

import { callReport, nonIntegerBani, ReportScenario } from './helpers/reports'
import { costOf, sellFrom, stockUp } from './helpers/stock'

let payload: Payload
let s: ReportScenario
let main: string
let shop: string
const ids: Record<string, string> = {}

const tag = `RSTK${Date.now()}`

type Row = {
  product: { id: string; title: string; article: string }
  qtyByWarehouse: Array<{ warehouse: string; code: string; qty: number; valueBani: number }>
  totalQty: number
  valueBani: number
  avgCostBani: number
}

/** Звіт лише по товарах цього тесту: усі вони мають `tag` у назві. */
const stock = async (query: Record<string, string | number | boolean> = {}) => {
  const { status, body } = await callReport(payload, stockReport, { q: tag, ...query })
  expect(status).toBe(200)
  return body
}

const titles = (rows: Row[]) => rows.map((row) => row.product.title.replace(`${tag} `, ''))

describe('R1: звіт залишків', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()
    main = s.warehouse
    shop = await s.newWarehouse('shop')

    // Назви задають порядок сортування; E містить спецсимволи регулярних виразів.
    ids.a = await s.newProduct(100, `${tag} A`)
    ids.b = await s.newProduct(100, `${tag} B`)
    ids.c = await s.newProduct(100, `${tag} C`)
    ids.d = await s.newProduct(100, `${tag} D`)
    ids.e = await s.newProduct(100, `${tag} E (50%) [x]*.+?`)

    // A: 100 бані на 1 + 2 шт. — непарний розподіл 33,33 / 66,67, потрібен залишковий бан.
    await stockUp(payload, ids.a, main, 1, 50)
    await stockUp(payload, ids.a, shop, 2, 50)
    await stockUp(payload, ids.b, main, 3, 1000)
    // C: продано все, залишку немає.
    await stockUp(payload, ids.c, main, 2, 400)
    await sellFrom(payload, ids.c, main, 2)
    // D: середня 5003 / 5 = 1000,6 → 1001 для показу.
    await stockUp(payload, ids.d, shop, 5, 5003)
    await stockUp(payload, ids.e, main, 7, 777)
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('по товарах: склади, кількість, вартість, середня; товар без залишку не потрапляє', async () => {
    const body = await stock()
    const rows = body.items as Row[]

    expect(body).toMatchObject({ currency: 'MDL', unit: 'bani' })
    expect(titles(rows)).toEqual(['A', 'B', 'D', 'E (50%) [x]*.+?'])

    const a = rows[0]
    expect(a.product).toMatchObject({ id: ids.a, title: `${tag} A` })
    expect(a.product.article).toMatch(/^ART-/)
    expect(a.totalQty).toBe(3)
    expect(a.valueBani).toBe(100)
    expect(a.avgCostBani).toBe(33)
    expect(Object.fromEntries(a.qtyByWarehouse.map((item) => [item.warehouse, [item.qty, item.valueBani, item.code]]))).toEqual({
      [main]: [1, 33, `${tag}-main`],
      [shop]: [2, 67, `${tag}-shop`],
    })

    expect(rows[2]).toMatchObject({ totalQty: 5, valueBani: 5003, avgCostBani: 1001 })
    expect(nonIntegerBani(body)).toEqual([])
  })

  it('Σ вартості по складах = product-costs.valueBani для кожного товару', async () => {
    const rows = (await stock()).items as Row[]

    for (const row of rows) {
      const cost = await costOf(payload, row.product.id)
      expect(row.qtyByWarehouse.reduce((sum, item) => sum + item.valueBani, 0)).toBe(cost.valueBani)
      expect(row.valueBani).toBe(cost.valueBani)
      expect(row.totalQty).toBe(cost.qty)
    }
  })

  it('totals = Σ рядків усіх сторінок; пагінація стабільна (назва, потім id)', async () => {
    const first = await stock({ limit: 3 })
    const second = await stock({ limit: 3, page: 2 })
    const rows = [...first.items, ...second.items] as Row[]

    expect(titles(rows)).toEqual(['A', 'B', 'D', 'E (50%) [x]*.+?'])
    expect(first.pagination).toEqual({ page: 1, limit: 3, total: 4 })
    expect(second.pagination).toEqual({ page: 2, limit: 3, total: 4 })
    for (const body of [first, second]) {
      expect(body.totals).toEqual({
        totalQty: rows.reduce((sum, row) => sum + row.totalQty, 0),
        totalValueBani: rows.reduce((sum, row) => sum + row.valueBani, 0),
        count: 4,
      })
    }
    expect(first.totals).toEqual({ totalQty: 18, totalValueBani: 100 + 1000 + 5003 + 777, count: 4 })
    expect(await stock({ limit: 3 })).toEqual(first)
  })

  it('фільтр складу повертає лише частку цього складу; totals за тим самим фільтром', async () => {
    const body = await stock({ warehouse: shop })
    const rows = body.items as Row[]

    expect(titles(rows)).toEqual(['A', 'D'])
    expect(rows[0]).toMatchObject({ totalQty: 2, valueBani: 67, avgCostBani: 34 })
    expect(rows[0].qtyByWarehouse).toEqual([{ warehouse: shop, code: `${tag}-shop`, qty: 2, valueBani: 67 }])
    expect(body.totals).toEqual({ totalQty: 7, totalValueBani: 67 + 5003, count: 2 })

    const onMain = await stock({ warehouse: main })
    expect(titles(onMain.items)).toEqual(['A', 'B', 'E (50%) [x]*.+?'])
    expect(onMain.totals.totalValueBani + body.totals.totalValueBani).toBe(100 + 1000 + 5003 + 777)
  })

  it('onlyPositive=false показує товар без залишку з нулями', async () => {
    const body = await stock({ onlyPositive: false })
    const c = (body.items as Row[]).find((row) => row.product.id === ids.c)

    expect(titles(body.items)).toEqual(['A', 'B', 'C', 'D', 'E (50%) [x]*.+?'])
    expect(c).toMatchObject({ totalQty: 0, valueBani: 0, avgCostBani: 0, qtyByWarehouse: [] })
  })

  it('пошук за назвою й артикулом: спецсимволи літеральні, регулярка з рядка не виконується', async () => {
    expect(titles((await stock({ q: `${tag} E (50%) [x]*.+?` })).items)).toEqual(['E (50%) [x]*.+?'])
    expect((await stock({ q: `${tag}.*` })).items).toEqual([])
    expect((await stock({ q: `${tag} [A-D]` })).items).toEqual([])

    const article = ((await stock()).items as Row[])[1].product.article
    expect(titles((await stock({ q: article.toLowerCase() })).items)).toEqual(['B'])
  })

  it('неіснуючий склад: 400 not_found; занадто довгий q: 400 range', async () => {
    const missing = await callReport(payload, stockReport, { warehouse: 'aaaaaaaaaaaaaaaaaaaaaaaa' })
    expect(missing.status).toBe(400)
    expect(missing.body.fields).toEqual([{ field: 'warehouse', reason: 'not_found' }])

    const long = await callReport(payload, stockReport, { q: 'x'.repeat(101), onlyPositive: 'maybe' })
    expect(long.status).toBe(400)
    expect(long.body.fields).toEqual([
      { field: 'q', reason: 'range' },
      { field: 'onlyPositive', reason: 'format' },
    ])
  })
})
