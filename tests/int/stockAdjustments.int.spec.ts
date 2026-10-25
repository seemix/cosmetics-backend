import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { InsufficientStockError } from '@/services/stock/errors'

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
  stockUp,
} from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brandId: string
let warehouseId: string
let otherWarehouseId: string

const tag = `ADJT-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const adjustments: Array<number | string> = []

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

// Після update зв'язки повертаються об'єктами (depth 1).
const pid = (product: unknown) => String(typeof product === 'object' ? (product as { id: string }).id : product)

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

type Line = { product: string; quantity?: number; countedQty?: number; unitCostBani?: number }

const createDraft = async (
  kind: 'writeoff' | 'inventory',
  lines: Line[],
  extra: { reason?: 'damage' | 'expired' | 'tester' | 'internal' | 'other' } = {},
) => {
  const doc = await payload.create({
    collection: 'stock-adjustments',
    data: {
      status: 'draft',
      documentDate: '2026-10-20T00:00:00.000Z',
      kind,
      warehouse: warehouseId,
      lines,
      ...extra,
    },
    ...asAdmin,
  })
  adjustments.push(doc.id)
  return doc
}

const writeoff = (lines: Line[]) => createDraft('writeoff', lines, { reason: 'damage' })

const post = (id: number | string) =>
  payload.update({ collection: 'stock-adjustments', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'stock-adjustments',
    id,
    data: { status: 'reversed', reversalReason: 'entered twice' },
    ...asAdmin,
  })

describe('A11: списання й інвентаризація', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    brandId = String((await data.brand()).id)

    for (const code of ['a', 'b']) {
      const warehouse = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(warehouse.id))
    }
    ;[warehouseId, otherWarehouseId] = warehouses
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'stock-adjustments', adjustments)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  describe('валідація чернетки', () => {
    it('номер ADJ з лічильника adjustmentNumber', async () => {
      const product = await newProduct()
      const draft = await writeoff([{ product, quantity: 1 }])
      const counter = await payload.db.connection
        .collection<{ _id: string; value: number }>('counters')
        .findOne({ _id: 'adjustmentNumber' })

      expect(draft.number).toBe(`ADJ-${String(counter?.value).padStart(6, '0')}`)
    })

    it('writeoff: причина обов’язкова, кількість ціла й додатна', async () => {
      const product = await newProduct()

      await expect(createDraft('writeoff', [{ product, quantity: 1 }])).rejects.toThrow(/Reason/)
      await expect(writeoff([{ product }])).rejects.toThrow(/quantity/i)
      await expect(writeoff([{ product, quantity: 0 }])).rejects.toThrow()
      await expect(writeoff([{ product, quantity: 1.5 }])).rejects.toThrow()
    })

    it('inventory: countedQty обов’язкова, ціла, не менше 0; нуль дозволений', async () => {
      const product = await newProduct()

      await expect(createDraft('inventory', [{ product }])).rejects.toThrow(/Counted/)
      await expect(createDraft('inventory', [{ product, countedQty: -1 }])).rejects.toThrow()
      await expect(createDraft('inventory', [{ product, countedQty: 1.5 }])).rejects.toThrow()
      await expect(createDraft('inventory', [{ product, countedQty: 0 }])).resolves.toBeDefined()
    })

    it('товар не може повторюватися в документі', async () => {
      const product = await newProduct()

      await expect(
        writeoff([
          { product, quantity: 1 },
          { product, quantity: 2 },
        ]),
      ).rejects.toThrow(/only once/)
    })
  })

  describe('writeoff', () => {
    it('списує за середньою: кеш, журнал і вартість у рядках', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      await stockUp(payload, a, warehouseId, 14, 173735)
      await stockUp(payload, b, warehouseId, 4, 46000)
      const draft = await writeoff([
        { product: a, quantity: 3 },
        { product: b, quantity: 4 },
      ])
      expect(await qtyAt(payload, a, warehouseId)).toBe(14)

      const posted = await post(draft.id)

      // round(173735 × 3 / 14) = 37 229; останнє списання забирає всю вартість.
      const values = Object.fromEntries(posted.lines.map((line) => [pid(line.product), line.valueBani]))
      expect(values).toEqual({ [a]: -37229, [b]: -46000 })
      expect(await costOf(payload, a)).toEqual({ qty: 11, valueBani: 136506 })
      expect(await costOf(payload, b)).toEqual({ qty: 0, valueBani: 0 })
      expect(await qtyAt(payload, a, warehouseId)).toBe(11)

      const moves = await movesOfDoc(payload, 'stock-adjustments', draft.id)
      expect(moves.every((move) => move.moveType === 'writeoff' && move.docNumber === posted.number)).toBe(true)
      expect(moves.map((move) => move.valueDeltaBani).sort((x, y) => x - y)).toEqual([-46000, -37229])
    })

    it('нестача блокує проведення й нічого не змінює', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 2, 200)
      const draft = await writeoff([{ product, quantity: 5 }])

      const error = await post(draft.id).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(InsufficientStockError)
      expect((await payload.findByID({ collection: 'stock-adjustments', id: draft.id })).status).toBe('draft')
      expect(await costOf(payload, product)).toEqual({ qty: 2, valueBani: 200 })
    })

    it('сторно повертає точні значення', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      await stockUp(payload, a, warehouseId, 14, 173735)
      await stockUp(payload, b, warehouseId, 4, 46000)
      const draft = await writeoff([
        { product: a, quantity: 3 },
        { product: b, quantity: 4 },
      ])
      await post(draft.id)

      const reversed = await reverse(draft.id)

      expect(reversed.status).toBe('reversed')
      expect(await costOf(payload, a)).toEqual({ qty: 14, valueBani: 173735 })
      expect(await costOf(payload, b)).toEqual({ qty: 4, valueBani: 46000 })
      expect(await qtyAt(payload, a, warehouseId)).toBe(14)
      expect(await qtyAt(payload, b, warehouseId)).toBe(4)

      const moves = await movesOfDoc(payload, 'stock-adjustments', draft.id)
      expect(moves.filter((move) => move.moveType === 'reversal')).toHaveLength(2)
      expect(moves.reduce((sum, move) => sum + move.valueDeltaBani, 0)).toBe(0)
    })
  })

  describe('inventory', () => {
    it('фіксує expectedQty при проведенні, а не при збереженні чернетки', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 10, 1000)
      const draft = await createDraft('inventory', [{ product, countedQty: 8 }])
      expect(draft.lines[0].expectedQty ?? null).toBeNull()

      // Між чернеткою й проведенням залишок змінився.
      await stockUp(payload, product, warehouseId, 2, 200)
      const posted = await post(draft.id)

      expect(posted.lines[0]).toMatchObject({ countedQty: 8, expectedQty: 12, diffQty: -4 })
    })

    it('нестача списується за середньою, надлишок приходує за поточною середньою', async () => {
      const [short, surplus, equal] = [await newProduct(), await newProduct(), await newProduct()]
      await stockUp(payload, short, warehouseId, 14, 173735)
      await stockUp(payload, surplus, warehouseId, 3, 1000)
      await stockUp(payload, equal, warehouseId, 5, 500)
      const draft = await createDraft('inventory', [
        { product: short, countedQty: 11 },
        { product: surplus, countedQty: 5 },
        { product: equal, countedQty: 5 },
      ])

      const posted = await post(draft.id)

      const line = (product: string) => posted.lines.find((row) => pid(row.product) === product)
      expect(line(short)).toMatchObject({ expectedQty: 14, diffQty: -3, valueBani: -37229 })
      // round(1000 × 2 / 3) = 667
      expect(line(surplus)).toMatchObject({ expectedQty: 3, diffQty: 2, valueBani: 667 })
      expect(line(equal)).toMatchObject({ expectedQty: 5, diffQty: 0, valueBani: 0 })
      expect(await costOf(payload, short)).toEqual({ qty: 11, valueBani: 136506 })
      expect(await costOf(payload, surplus)).toEqual({ qty: 5, valueBani: 1667 })
      expect(await costOf(payload, equal)).toEqual({ qty: 5, valueBani: 500 })
      expect(await qtyAt(payload, surplus, warehouseId)).toBe(5)

      // Рядок без різниці рух не пише.
      const moves = await movesOfDoc(payload, 'stock-adjustments', draft.id)
      expect(moves).toHaveLength(2)
      expect(moves.every((move) => move.moveType === 'inventory')).toBe(true)
    })

    it('середня рахується по товару, а різниця по складу', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 2, 1000)
      await stockUp(payload, product, otherWarehouseId, 2, 3000)
      // Усього 4 / 4000, на складі 2. Підрахунок 3: надлишок 1 за середньою 1000.
      const draft = await createDraft('inventory', [{ product, countedQty: 3 }])

      const posted = await post(draft.id)

      expect(posted.lines[0]).toMatchObject({ expectedQty: 2, diffQty: 1, valueBani: 1000 })
      expect(await costOf(payload, product)).toEqual({ qty: 5, valueBani: 5000 })
    })

    it('надлишок при нульовій середній вимагає unitCostBani', async () => {
      const product = await newProduct()
      const draft = await createDraft('inventory', [{ product, countedQty: 4 }])

      await expect(post(draft.id)).rejects.toThrow(/Unit cost is required/)
      expect((await payload.findByID({ collection: 'stock-adjustments', id: draft.id })).status).toBe('draft')
      expect(await qtyAt(payload, product, warehouseId)).toBe(0)

      // Вказана собівартість дозволяє провести.
      await payload.update({
        collection: 'stock-adjustments',
        id: draft.id,
        data: { lines: [{ product, countedQty: 4, unitCostBani: 250 }] },
        ...asAdmin,
      })
      const posted = await post(draft.id)

      expect(posted.lines[0]).toMatchObject({ expectedQty: 0, diffQty: 4, valueBani: 1000 })
      expect(await costOf(payload, product)).toEqual({ qty: 4, valueBani: 1000 })
    })

    it('unitCostBani ігнорується, якщо середня вже є', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 2, 1000)
      const draft = await createDraft('inventory', [{ product, countedQty: 4, unitCostBani: 99999 }])

      const posted = await post(draft.id)

      expect(posted.lines[0].valueBani).toBe(1000)
      expect(await costOf(payload, product)).toEqual({ qty: 4, valueBani: 2000 })
    })

    it('підрахунок 0 списує весь залишок складу', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 3, 999)
      const draft = await createDraft('inventory', [{ product, countedQty: 0 }])

      const posted = await post(draft.id)

      expect(posted.lines[0]).toMatchObject({ expectedQty: 3, diffQty: -3, valueBani: -999 })
      expect(await costOf(payload, product)).toEqual({ qty: 0, valueBani: 0 })
    })

    it('сторно повертає точні значення і нестачі, і надлишку', async () => {
      const [short, surplus] = [await newProduct(), await newProduct()]
      await stockUp(payload, short, warehouseId, 14, 173735)
      await stockUp(payload, surplus, warehouseId, 3, 1000)
      const draft = await createDraft('inventory', [
        { product: short, countedQty: 11 },
        { product: surplus, countedQty: 5 },
      ])
      await post(draft.id)

      await reverse(draft.id)

      expect(await costOf(payload, short)).toEqual({ qty: 14, valueBani: 173735 })
      expect(await costOf(payload, surplus)).toEqual({ qty: 3, valueBani: 1000 })
      expect(await qtyAt(payload, short, warehouseId)).toBe(14)
      expect(await qtyAt(payload, surplus, warehouseId)).toBe(3)

      const moves = await movesOfDoc(payload, 'stock-adjustments', draft.id)
      expect(moves.reduce((sum, move) => sum + move.qtyDelta, 0)).toBe(0)
      expect(moves.reduce((sum, move) => sum + move.valueDeltaBani, 0)).toBe(0)
    })

    it('сторно надлишку відхилене, якщо його вже продано', async () => {
      const product = await newProduct()
      await stockUp(payload, product, warehouseId, 3, 1000)
      const draft = await createDraft('inventory', [{ product, countedQty: 5 }])
      await post(draft.id)
      await sellFrom(payload, product, warehouseId, 5)

      await expect(reverse(draft.id)).rejects.toBeInstanceOf(InsufficientStockError)
      expect((await payload.findByID({ collection: 'stock-adjustments', id: draft.id })).status).toBe('posted')
    })
  })

  it('проведений документ не змінюється, доступ лише admin', async () => {
    const product = await newProduct()
    await stockUp(payload, product, warehouseId, 2, 200)
    const draft = await writeoff([{ product, quantity: 1 }])
    await post(draft.id)

    await expect(
      payload.update({ collection: 'stock-adjustments', id: draft.id, data: { comment: 'x' }, ...asAdmin }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'stock-adjustments', id: draft.id, ...asAdmin })).rejects.toThrow()

    const customer = { id: 'c', roles: ['customer'], collection: 'users' } as unknown as AuthUser
    await expect(
      payload.find({ collection: 'stock-adjustments', user: customer, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
