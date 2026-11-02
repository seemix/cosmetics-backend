import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { salesReport, salesTransfer } from '@/endpoints/reports/sales'
import config from '@/payload.config'

import { at, callReport, randomDay, ReportScenario, shiftDay } from './helpers/reports'
import { qtyAt, stockUp } from './helpers/stock'

let payload: Payload
let s: ReportScenario
let main: string
let shop: string
const ids: Record<string, string> = {}

const tag = `RSAL${Date.now()}`
const day = randomDay()
const before = shiftDay(day, -1)
const after = shiftDay(day, 1)

type Row = { product: { id: string; title: string; article: string }; soldQty: number }

const titles = (rows: Row[]) => rows.map((row) => `${row.product.title.replace(`${tag} `, '')}:${row.soldQty}`)

describe('R1: продажі по складу й переміщення для поповнення', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    s = new ReportScenario(payload, tag)
    await s.setup()
    // Замовлення списуються з тестового складу (defaultAdminWarehouse).
    main = s.warehouse
    shop = await s.newWarehouse('shop')

    ids.a = await s.newProduct(100, `${tag} A`)
    ids.b = await s.newProduct(100, `${tag} B`)
    ids.c = await s.newProduct(100, `${tag} C`)
    ids.d = await s.newProduct(100, `${tag} D`)

    s.setNow(at(before, 9))
    for (const product of [ids.a, ids.b, ids.c, ids.d]) await stockUp(payload, product, main, 50, 5000)
    // Продаж напередодні: поза періодом.
    await s.order([{ product: ids.d, quantity: 4 }])

    s.setNow(at(day, 10))
    await s.order([
      { product: ids.b, quantity: 2 },
      { product: ids.a, quantity: 3 },
    ])
    await s.order([{ product: ids.a, quantity: 1 }])
    // C продано й скасовано в тому ж періоді: нічого не пішло зі складу.
    await s.cancel(await s.order([{ product: ids.c, quantity: 5 }]))

    s.setNow(at(after, 10))
    await s.order([{ product: ids.b, quantity: 7 }])
    s.realNow()
  })

  afterAll(async () => {
    await s.cleanup()
  })

  it('кількість проданого зі складу за період, без скасованого й поза періодом; за назвою', async () => {
    const { status, body } = await callReport(payload, salesReport, { from: day, to: day, warehouse: main })

    expect(status).toBe(200)
    expect(body).toMatchObject({ period: { from: day, to: day }, warehouse: main })
    expect(titles(body.items)).toEqual(['A:4', 'B:2'])
    expect(body.items[0].product.article).toMatch(/^ART-/)
    expect(body.totals).toEqual({ soldQty: 6, count: 2 })

    const wide = await callReport(payload, salesReport, { from: before, to: after, warehouse: main })
    expect(titles(wide.body.items)).toEqual(['A:4', 'B:9', 'D:4'])

    const other = await callReport(payload, salesReport, { from: day, to: day, warehouse: shop })
    expect(other.body.items).toEqual([])
  })

  it('склад обов’язковий; лише admin', async () => {
    const missing = await callReport(payload, salesReport, { from: day, to: day })
    expect(missing.status).toBe(400)
    expect(missing.body.fields).toEqual([{ field: 'warehouse', reason: 'required' }])

    expect((await callReport(payload, salesReport, { from: day, to: day, warehouse: main }, 'manager')).status).toBe(403)
    expect((await callReport(payload, salesTransfer, { from: day, to: day, warehouse: shop, source: main }, 'manager')).status).toBe(403)
  })

  it('переміщення: чернетка source → склад звіту з позиціями й кількостями, залишки не змінюються', async () => {
    const { status, body } = await callReport(payload, salesTransfer, { from: day, to: day, warehouse: main, source: shop }, s.admin)
    expect(status).toBe(201)
    s.remember('stock-transfers', body.id)

    const doc = await payload.findByID({ collection: 'stock-transfers', id: body.id, depth: 0 })
    expect(body).toEqual({ id: String(doc.id), number: doc.number, lines: 2 })
    expect(doc.number).toMatch(/^TRF/)
    expect(doc).toMatchObject({ status: 'draft', fromWarehouse: shop, toWarehouse: main })
    expect(doc.lines.map((line) => [line.product, line.quantity])).toEqual([
      [ids.a, 4],
      [ids.b, 2],
    ])
    expect(await qtyAt(payload, ids.a, main)).toBe(46)
    expect(await qtyAt(payload, ids.a, shop)).toBe(0)
  })

  it('однакові склади, нічого не продано, відсутній source: помилки без документа', async () => {
    const count = async () => (await payload.count({ collection: 'stock-transfers', where: { toWarehouse: { in: [main, shop] } } })).totalDocs
    const initial = await count()

    const same = await callReport(payload, salesTransfer, { from: day, to: day, warehouse: main, source: main }, s.admin)
    expect(same.status).toBe(400)
    expect(same.body.fields).toEqual([{ field: 'source', reason: 'same' }])

    const missing = await callReport(payload, salesTransfer, { from: day, to: day, warehouse: main }, s.admin)
    expect(missing.body.fields).toEqual([{ field: 'source', reason: 'required' }])

    const nothing = await callReport(payload, salesTransfer, { from: day, to: day, warehouse: shop, source: main }, s.admin)
    expect(nothing.status).toBe(422)
    expect(nothing.body.code).toBe('NOTHING_TO_TRANSFER')

    expect(await count()).toBe(initial)
  })
})
