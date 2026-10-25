import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { InsufficientStockError } from '@/services/stock/errors'

import { formatReport, importOpeningStock, parseCsv } from '../../scripts/import-opening-stock'
import { TestData } from './helpers/fixtures'
import {
  type AuthUser,
  cleanupStock,
  costOf,
  createAdmin,
  deleteDocumentsDirectly,
  movesOfDoc,
  qtyAt,
  sellFrom,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brandId: string
let mainId: string
let shopId: string
let mainCode: string
let shopCode: string

const tag = `OPNT-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const balances: Array<number | string> = []
const articles = new Map<string, string>()

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const newProduct = async () => {
  const doc = await data.product({ brand: brandId, retailPrice: 100 })
  products.push(String(doc.id))
  articles.set(String(doc.id), doc.article as string)
  return { id: String(doc.id), article: doc.article as string }
}

const importCsv = async (csv: string) => {
  const report = await importOpeningStock(payload, csv)
  if (report.draft) balances.push(report.draft.id)
  return report
}

const post = (id: number | string) =>
  payload.update({ collection: 'opening-balances', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'opening-balances',
    id,
    data: { status: 'reversed', reversalReason: 'wrong count' },
    ...asAdmin,
  })

describe('A12: початкові залишки і CSV-імпорт', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    brandId = String((await data.brand()).id)

    mainCode = `${tag}-main`
    shopCode = `${tag}-shop`
    for (const code of [mainCode, shopCode]) {
      const warehouse = await payload.create({ collection: 'warehouses', data: { name: code, code } })
      warehouses.push(String(warehouse.id))
    }
    ;[mainId, shopId] = warehouses
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'opening-balances', balances)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  describe('скрипт імпорту', () => {
    it('CSV із 3 рядків створює лише чернетку, залишки не змінюються', async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()]
      const csv = [
        'article; warehouseCode; qty; unitCostMDL',
        `${a.article}; ${mainCode}; 4; 115,00`,
        `${b.article}; ${mainCode}; 10; 12.5`,
        `${c.article}; ${shopCode}; 3; 249.90`,
        '',
      ].join('\r\n')

      const report = await importCsv(csv)

      expect(report.errors).toEqual([])
      expect(report.draft).toMatchObject({ lines: 3 })
      expect(formatReport(report)).toMatch(/Draft OPN-\d{6} created with 3 lines/)

      const draft = await payload.findByID({ collection: 'opening-balances', id: report.draft!.id, depth: 0 })
      expect(draft.status).toBe('draft')
      expect(draft.kind).toBe('stock')
      expect(
        draft.stockLines?.map((line) => [line.product, line.warehouse, line.quantity, line.unitCostBani]),
      ).toEqual([
        [a.id, mainId, 4, 11500],
        [b.id, mainId, 10, 1250],
        [c.id, shopId, 3, 24990],
      ])
      expect(await qtyAt(payload, a.id, mainId)).toBe(0)
      expect(await movesOfDoc(payload, 'opening-balances', draft.id)).toHaveLength(0)
    })

    it('помилки: невідомий артикул, невідомий склад, qty ≤ 0, cost ≤ 0, дубль; чернетка не створюється', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      const before = (await payload.count({ collection: 'opening-balances' })).totalDocs
      const csv = [
        `${a.article};${mainCode};4;115,00`, // 1: валідний
        `NO-SUCH-${tag};${mainCode};1;10`, // 2: невідомий артикул
        `${b.article};NO-WH-${tag};1;10`, // 3: невідомий склад
        `${b.article};${mainCode};0;10`, // 4: qty = 0
        `${b.article};${mainCode};-2;10`, // 5: qty < 0
        `${b.article};${mainCode};1.5;10`, // 6: qty дробове
        `${b.article};${mainCode};1;0`, // 7: cost = 0
        `${b.article};${mainCode};1;abc`, // 8: cost не число
        `${a.article};${mainCode};2;10`, // 9: дубль рядка 1
        `;${mainCode};1;10`, // 10: порожній артикул
      ].join('\n')

      const report = await importCsv(csv)

      expect(report.draft).toBeUndefined()
      const byLine = Object.fromEntries(report.errors.map((error) => [error.line, error.message]))
      expect(byLine[2]).toMatch(/Unknown article/)
      expect(byLine[3]).toMatch(/Unknown warehouse/)
      expect(byLine[4]).toMatch(/Quantity/)
      expect(byLine[5]).toMatch(/Quantity/)
      expect(byLine[6]).toMatch(/Quantity/)
      expect(byLine[7]).toMatch(/Unit cost/)
      expect(byLine[8]).toMatch(/Unit cost/)
      expect(byLine[9]).toMatch(/Duplicate.*line 1/)
      expect(byLine[10]).toMatch(/Article is empty/)
      expect(byLine[1]).toBeUndefined()
      expect(formatReport(report)).toMatch(/Import failed, no draft created/)
      expect((await payload.count({ collection: 'opening-balances' })).totalDocs).toBe(before)
    })

    it('порожній файл і файл лише із заголовком — помилка', async () => {
      expect((await importCsv('')).errors).toEqual([{ line: 0, message: 'The file has no data rows' }])
      expect((await importCsv('article;warehouseCode;qty;unitCostMDL\n')).draft).toBeUndefined()
    })

    it('parseCsv: заголовок, BOM, порожні рядки, номери рядків файлу', () => {
      expect(parseCsv('﻿article;warehouseCode;qty;unitCostMDL\n\nA1;main;2;5,50\n')).toEqual([
        { line: 3, article: 'A1', warehouseCode: 'main', qty: '2', cost: '5,50' },
      ])
    })
  })

  describe('колекція', () => {
    const importedDraft = async (lines: Array<{ article: string; code: string; qty: number; cost: string }>) => {
      const report = await importCsv(lines.map((l) => `${l.article};${l.code};${l.qty};${l.cost}`).join('\n'))
      expect(report.errors).toEqual([])
      return report.draft!
    }

    it('проведення як прихід: кеш, журнал opening, вартість quantity × unitCostBani', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      const draft = await importedDraft([
        { article: a.article, code: mainCode, qty: 4, cost: '115,00' },
        { article: b.article, code: shopCode, qty: 3, cost: '249,90' },
      ])

      const posted = await post(draft.id)

      expect(posted.status).toBe('posted')
      expect(await costOf(payload, a.id)).toEqual({ qty: 4, valueBani: 46000 })
      expect(await costOf(payload, b.id)).toEqual({ qty: 3, valueBani: 74970 })
      expect(await qtyAt(payload, a.id, mainId)).toBe(4)
      expect(await qtyAt(payload, b.id, shopId)).toBe(3)

      const moves = await movesOfDoc(payload, 'opening-balances', draft.id)
      expect(moves).toHaveLength(2)
      expect(moves.every((move) => move.moveType === 'opening' && move.docNumber === posted.number)).toBe(true)
    })

    it('сторно повертає кеш у вихідний стан; якщо вже продано, відхиляється', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      const draft = await importedDraft([
        { article: a.article, code: mainCode, qty: 4, cost: '115,00' },
        { article: b.article, code: mainCode, qty: 2, cost: '10,00' },
      ])
      await post(draft.id)
      await sellFrom(payload, b.id, mainId, 1)

      await expect(reverse(draft.id)).rejects.toBeInstanceOf(InsufficientStockError)
      expect(await costOf(payload, a.id)).toEqual({ qty: 4, valueBani: 46000 })

      // Скасувати продаж не можна без документа замовлення, тож перевіряємо чистий випадок на іншому документі.
      const clean = await importedDraft([{ article: a.article, code: shopCode, qty: 6, cost: '20,00' }])
      await post(clean.id)
      await reverse(clean.id)

      expect(await costOf(payload, a.id)).toEqual({ qty: 4, valueBani: 46000 })
      expect(await qtyAt(payload, a.id, shopId)).toBe(0)
      const moves = await movesOfDoc(payload, 'opening-balances', clean.id)
      expect(moves.reduce((sum, move) => sum + move.valueDeltaBani, 0)).toBe(0)
    })

    it('дубль товар × склад у чернетці відхиляється й при ручному вводі', async () => {
      const a = await newProduct()
      const line = { product: a.id, warehouse: mainId, quantity: 1, unitCostBani: 100 }

      await expect(
        payload.create({
          collection: 'opening-balances',
          data: {
            status: 'draft',
            kind: 'stock',
            documentDate: '2026-10-24T00:00:00.000Z',
            stockLines: [line, { ...line, quantity: 2 }],
          },
          ...asAdmin,
        }),
      ).rejects.toThrow(/only once per warehouse/)
    })

    it('проведений документ не змінюється, доступ лише admin', async () => {
      const a = await newProduct()
      const draft = await importedDraft([{ article: a.article, code: mainCode, qty: 1, cost: '1,00' }])
      await post(draft.id)

      await expect(
        payload.update({ collection: 'opening-balances', id: draft.id, data: { comment: 'x' }, ...asAdmin }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'opening-balances', id: draft.id, ...asAdmin })).rejects.toThrow()

      const customer = { id: 'c', roles: ['customer'], collection: 'users' } as unknown as AuthUser
      await expect(
        payload.find({ collection: 'opening-balances', user: customer, overrideAccess: false }),
      ).rejects.toThrow()
    })
  })
})
