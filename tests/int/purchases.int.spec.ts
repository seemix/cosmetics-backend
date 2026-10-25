import {
  commitTransaction,
  createLocalReq,
  getPayload,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { Purchase, User } from '@/payload-types'
import { issue, receive } from '@/services/stock/stockLedger.service'

import { TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let brandId: string
let supplierId: string
let warehouseId: string

const tag = `PURT-${Date.now()}`
const products: string[] = []
const purchases: Array<number | string> = []

type AuthUser = User & { collection: 'users' }
const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as AuthUser
const customer = asUser(['customer'])
// postedBy / reversedBy зберігаються як зв'язок, тож admin має бути справжнім користувачем.
let admin: AuthUser
const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

const inTransaction = async <T>(fn: (req: PayloadRequest) => Promise<T>): Promise<T> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const result = await fn(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

const testDoc = { collection: 'test-docs', id: tag }
const opening = (product: string, qty: number, valueBani: number) =>
  inTransaction((req) =>
    receive(req, { doc: testDoc, moveType: 'opening', lines: [{ product, warehouse: warehouseId, qty, valueBani }] }),
  )
const sell = (product: string, qty: number) =>
  inTransaction((req) =>
    issue(req, { doc: testDoc, moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty }] }),
  )

const cost = async (product: string) => {
  const doc = (await payload.find({ collection: 'product-costs', where: { product: { equals: product } }, depth: 0 }))
    .docs[0]
  return { qty: doc?.qty ?? 0, valueBani: doc?.valueBani ?? 0 }
}

const qtyAt = async (product: string) =>
  (
    await payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouseId } },
      depth: 0,
    })
  ).docs[0]?.qty ?? 0

const movesOf = async (id: number | string) =>
  (
    await payload.find({
      collection: 'stock-moves',
      where: { docCollection: { equals: 'purchases' }, docId: { equals: String(id) } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

type LineInput = { product: string; quantity: number; unitPriceBani: number }

const createDraft = async (lines: LineInput[], extraCostsBani: number[] = []) => {
  const doc = await payload.create({
    collection: 'purchases',
    data: {
      status: 'draft',
      documentDate: '2026-10-20T00:00:00.000Z',
      supplier: supplierId,
      warehouse: warehouseId,
      allocationBase: 'amount',
      lines,
      extraCosts: extraCostsBani.map((amountBani) => ({ description: 'Logistics', amountBani, payee: supplierId })),
    },
    ...asAdmin,
  })
  purchases.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'purchases', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string, reversalReason = 'wrong invoice') =>
  payload.update({ collection: 'purchases', id, data: { status: 'reversed', reversalReason }, ...asAdmin })

// Розд. 5.2 дизайну: три рядки й логістика 150,00 MDL.
const exampleLines = (a: string, b: string, c: string): LineInput[] => [
  { product: a, quantity: 10, unitPriceBani: 12000 },
  { product: b, quantity: 5, unitPriceBani: 7550 },
  { product: c, quantity: 3, unitPriceBani: 24990 },
]

describe('A9: приходна накладна', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    const user = await data.user()
    admin = {
      ...(await payload.update({ collection: 'users', id: user.id, data: { roles: ['admin'] } })),
      collection: 'users',
    } as AuthUser
    brandId = String((await data.brand()).id)
    supplierId = String((await payload.create({ collection: 'suppliers', data: { name: `${tag} supplier` } })).id)
    warehouseId = String(
      (await payload.create({ collection: 'warehouses', data: { name: `${tag} wh`, code: `${tag}-wh` } })).id,
    )
  })

  afterAll(async () => {
    const byProduct = { product: { in: products } }
    await payload.delete({ collection: 'stock-moves', where: byProduct })
    await payload.delete({ collection: 'stock-balances', where: byProduct })
    await payload.delete({ collection: 'product-costs', where: byProduct })
    // Проведені накладні не видаляються хуком, тож прибираємо їх напряму в БД.
    await payload.db.collections.purchases.collection.deleteMany({
      _id: { $in: purchases.map((id) => new payload.db.collections.purchases.base.Types.ObjectId(String(id))) },
    })
    await payload.delete({ collection: 'warehouses', id: warehouseId })
    await payload.delete({ collection: 'suppliers', id: supplierId })
    await data.cleanup()
  })

  describe('чернетка', () => {
    it('рахує суми через calculatePurchase на створенні й кожному збереженні', async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()]
      const draft = await createDraft(exampleLines(a, b, c), [15000])

      expect(draft.status).toBe('draft')
      expect(draft.number).toMatch(/^PUR-\d{6}$/)
      expect(draft.lines.map((line) => [line.amountBani, line.allocatedBani, line.landedBani])).toEqual([
        [120000, 7735, 127735],
        [37750, 2433, 40183],
        [74970, 4832, 79802],
      ])
      expect(draft).toMatchObject({ goodsTotalBani: 232720, extraTotalBani: 15000, landedTotalBani: 247720 })

      // Зміна бази без передачі рядків перераховує з наявних рядків.
      const updated = await payload.update({
        collection: 'purchases',
        id: draft.id,
        data: { allocationBase: 'quantity' },
        ...asAdmin,
      })
      expect(updated.lines.map((line) => line.allocatedBani)).toEqual([8333, 4167, 2500])

      // Ручне значення розрахункового поля перезаписується.
      const tampered = await payload.update({
        collection: 'purchases',
        id: draft.id,
        data: { landedTotalBani: 1, lines: updated.lines.map((line) => ({ ...line, landedBani: 1 })) },
        ...asAdmin,
      })
      expect(tampered.landedTotalBani).toBe(247720)
      expect(tampered.lines[0].landedBani).toBe(128333)
    })

    it('доступ лише для admin', async () => {
      await expect(
        payload.find({ collection: 'purchases', user: customer, overrideAccess: false }),
      ).rejects.toThrow()
      await expect(
        payload.create({
          collection: 'purchases',
          data: {
            status: 'draft',
            documentDate: '2026-10-20',
            supplier: supplierId,
            warehouse: warehouseId,
            allocationBase: 'amount',
            lines: [{ product: products[0], quantity: 1, unitPriceBani: 1 }],
          },
          user: customer,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('дробова кількість відхиляється валідацією', async () => {
      const product = await newProduct()

      await expect(createDraft([{ product, quantity: 1.5, unitPriceBani: 100 }])).rejects.toThrow()
    })
  })

  describe('проведення', () => {
    it('змінює кеш і журнал на посадочну вартість', async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()]
      await opening(a, 4, 46000)
      const draft = await createDraft(exampleLines(a, b, c), [15000])

      const posted = await post(draft.id)

      expect(posted.status).toBe('posted')
      expect(posted.postedAt).toBeTruthy()
      expect(await cost(a)).toEqual({ qty: 14, valueBani: 173735 })
      expect(await cost(b)).toEqual({ qty: 5, valueBani: 40183 })
      expect(await cost(c)).toEqual({ qty: 3, valueBani: 79802 })
      expect(await qtyAt(a)).toBe(14)

      const moves = await movesOf(draft.id)
      expect(moves).toHaveLength(3)
      expect(moves.every((move) => move.moveType === 'purchase' && move.docNumber === posted.number)).toBe(true)
      expect(moves.every((move) => move.date === posted.postedAt)).toBe(true)
      expect(moves.map((move) => move.valueDeltaBani).sort((x, y) => x - y)).toEqual([40183, 79802, 127735])

      const lastCost = (await payload.find({ collection: 'product-costs', where: { product: { equals: a } } }))
        .docs[0]
      expect(lastCost.lastPurchaseUnitCostBani).toBeCloseTo(12773.5, 6)
    })

    it('проведену накладну не можна змінити чи видалити', async () => {
      const product = await newProduct()
      const draft = await createDraft([{ product, quantity: 2, unitPriceBani: 500 }])
      await post(draft.id)

      await expect(
        payload.update({ collection: 'purchases', id: draft.id, data: { supplierInvoiceNo: 'X-1' }, ...asAdmin }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'purchases', id: draft.id, ...asAdmin })).rejects.toThrow()
      expect(await qtyAt(product)).toBe(2)
    })

    it('чернетку можна видалити, кеш не змінюється', async () => {
      const product = await newProduct()
      const draft = await createDraft([{ product, quantity: 2, unitPriceBani: 500 }])

      await payload.delete({ collection: 'purchases', id: draft.id, ...asAdmin })

      expect(await qtyAt(product)).toBe(0)
      expect(await movesOf(draft.id)).toHaveLength(0)
    })
  })

  describe('сторно', () => {
    it('без продажів повертає кеш у вихідний стан', async () => {
      const [a, b, c] = [await newProduct(), await newProduct(), await newProduct()]
      await opening(a, 4, 46000)
      const draft = await createDraft(exampleLines(a, b, c), [15000])
      await post(draft.id)

      const reversed = await reverse(draft.id)

      expect(reversed).toMatchObject({ status: 'reversed', reversalReason: 'wrong invoice' })
      expect(await cost(a)).toEqual({ qty: 4, valueBani: 46000 })
      expect(await cost(b)).toEqual({ qty: 0, valueBani: 0 })
      expect(await cost(c)).toEqual({ qty: 0, valueBani: 0 })
      expect(await qtyAt(a)).toBe(4)

      const moves = await movesOf(draft.id)
      const reversals = moves.filter((move) => move.moveType === 'reversal')
      expect(reversals).toHaveLength(3)
      expect(reversals.every((move) => move.date === reversed.reversedAt && move.reversalOf)).toBe(true)
      expect(moves.reduce((sum, move) => sum + move.qtyDelta, 0)).toBe(0)
      expect(moves.reduce((sum, move) => sum + move.valueDeltaBani, 0)).toBe(0)
    })

    it('без причини відхилене', async () => {
      const product = await newProduct()
      const draft = await createDraft([{ product, quantity: 2, unitPriceBani: 500 }])
      await post(draft.id)

      await expect(
        payload.update({ collection: 'purchases', id: draft.id, data: { status: 'reversed' }, ...asAdmin }),
      ).rejects.toThrow()
      expect(await qtyAt(product)).toBe(2)
    })

    it('при недостатньому залишку відхилене й нічого не змінює', async () => {
      const [a, b] = [await newProduct(), await newProduct()]
      const draft = await createDraft([
        { product: a, quantity: 10, unitPriceBani: 1000 },
        { product: b, quantity: 5, unitPriceBani: 2000 },
      ])
      await post(draft.id)
      await sell(a, 3)
      const before = { a: await cost(a), b: await cost(b), qtyA: await qtyAt(a), qtyB: await qtyAt(b) }

      await expect(reverse(draft.id)).rejects.toThrow(/Insufficient stock/)

      const doc = (await payload.findByID({ collection: 'purchases', id: draft.id })) as Purchase
      expect(doc.status).toBe('posted')
      expect(doc.reversedAt ?? null).toBeNull()
      expect({ a: await cost(a), b: await cost(b), qtyA: await qtyAt(a), qtyB: await qtyAt(b) }).toEqual(before)
      expect((await movesOf(draft.id)).filter((move) => move.moveType === 'reversal')).toHaveLength(0)
    })

    it('qty = 0 ⇒ valueBani = 0, навіть якщо залишок вартості не дорівнює landed', async () => {
      const product = await newProduct()
      await opening(product, 3, 1000)
      const draft = await createDraft([{ product, quantity: 3, unitPriceBani: 667 }])
      await post(draft.id)
      // 6 шт. на 3001: продаж 3 шт. забирає round(3001 × 3 / 6) = 1501, лишається 3 / 1500.
      await sell(product, 3)
      expect(await cost(product)).toEqual({ qty: 3, valueBani: 1500 })

      await reverse(draft.id)

      expect(await cost(product)).toEqual({ qty: 0, valueBani: 0 })
      const [reversal] = (await movesOf(draft.id)).filter((move) => move.moveType === 'reversal')
      expect(reversal.valueDeltaBani).toBe(-1500)
    })

    it('блокується, якщо вартість залишку стала б від’ємною при qty > 0', async () => {
      const product = await newProduct()
      await opening(product, 2, 2)
      const draft = await createDraft([{ product, quantity: 10, unitPriceBani: 10000 }])
      await post(draft.id)
      // 12 / 100 002 → продаж 2 шт. (16 667) → 10 / 83 335 → прихід 5 шт. за 5 бані → 15 / 83 340.
      await sell(product, 2)
      await opening(product, 5, 5)
      const before = await cost(product)

      await expect(reverse(draft.id)).rejects.toThrow(/negative/)

      expect(await cost(product)).toEqual(before)
      expect((await payload.findByID({ collection: 'purchases', id: draft.id })).status).toBe('posted')
    })
  })
})
