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
let mainId: string
let shopId: string

const tag = `TRFT-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const transfers: Array<number | string> = []

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

const createDraft = async (
  lines: Array<{ product: string; quantity: number }>,
  from = mainId,
  to = shopId,
) => {
  const doc = await payload.create({
    collection: 'stock-transfers',
    data: {
      status: 'draft',
      documentDate: '2026-10-20T00:00:00.000Z',
      fromWarehouse: from,
      toWarehouse: to,
      lines,
    },
    ...asAdmin,
  })
  transfers.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'stock-transfers', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'stock-transfers',
    id,
    data: { status: 'reversed', reversalReason: 'moved by mistake' },
    ...asAdmin,
  })

describe('A10: переміщення між складами', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    brandId = String((await data.brand()).id)

    for (const code of ['main', 'shop']) {
      const warehouse = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(warehouse.id))
    }
    ;[mainId, shopId] = warehouses
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'stock-transfers', transfers)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  it('номер TRF з лічильника transferNumber, чернетка нічого не змінює', async () => {
    const product = await newProduct()
    await stockUp(payload, product, mainId, 5, 1000)

    const draft = await createDraft([{ product, quantity: 2 }])
    const counter = await payload.db.connection
      .collection<{ _id: string; value: number }>('counters')
      .findOne({ _id: 'transferNumber' })

    expect(draft.status).toBe('draft')
    expect(draft.number).toBe(`TRF-${String(counter?.value).padStart(6, '0')}`)
    expect(await qtyAt(payload, product, mainId)).toBe(5)
    expect(await movesOfDoc(payload, 'stock-transfers', draft.id)).toHaveLength(0)
  })

  it('склади мають бути різні', async () => {
    const product = await newProduct()

    await expect(createDraft([{ product, quantity: 1 }], mainId, mainId)).rejects.toThrow(/differ/)

    // Те саме при редагуванні чернетки.
    const draft = await createDraft([{ product, quantity: 1 }])
    await expect(
      payload.update({ collection: 'stock-transfers', id: draft.id, data: { toWarehouse: mainId }, ...asAdmin }),
    ).rejects.toThrow(/differ/)
  })

  it('кількість: ціле число більше нуля', async () => {
    const product = await newProduct()

    await expect(createDraft([{ product, quantity: 0 }])).rejects.toThrow()
    await expect(createDraft([{ product, quantity: 1.5 }])).rejects.toThrow()
  })

  it('проведення переносить залишок, product-costs не змінюється, два рухи на рядок', async () => {
    const [a, b] = [await newProduct(), await newProduct()]
    await stockUp(payload, a, mainId, 5, 1000)
    await stockUp(payload, b, mainId, 3, 900)
    const draft = await createDraft([
      { product: a, quantity: 3 },
      { product: b, quantity: 3 },
    ])

    const posted = await post(draft.id)

    expect(posted.status).toBe('posted')
    expect(await qtyAt(payload, a, mainId)).toBe(2)
    expect(await qtyAt(payload, a, shopId)).toBe(3)
    expect(await qtyAt(payload, b, mainId)).toBe(0)
    expect(await qtyAt(payload, b, shopId)).toBe(3)
    expect(await costOf(payload, a)).toEqual({ qty: 5, valueBani: 1000 })
    expect(await costOf(payload, b)).toEqual({ qty: 3, valueBani: 900 })

    const moves = await movesOfDoc(payload, 'stock-transfers', draft.id)
    expect(moves).toHaveLength(4)
    expect(moves.every((move) => move.valueDeltaBani === 0 && move.docNumber === posted.number)).toBe(true)
    expect(moves.map((move) => move.moveType).sort()).toEqual([
      'transfer_in',
      'transfer_in',
      'transfer_out',
      'transfer_out',
    ])
  })

  it('нестача на складі-джерелі блокує проведення й нічого не змінює', async () => {
    const [a, b] = [await newProduct(), await newProduct()]
    await stockUp(payload, a, mainId, 5, 1000)
    await stockUp(payload, b, mainId, 1, 100)
    const draft = await createDraft([
      { product: a, quantity: 2 },
      { product: b, quantity: 4 },
    ])

    const error = await post(draft.id).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(InsufficientStockError)
    expect((error as InsufficientStockError).items).toEqual([
      { product: b, warehouse: mainId, requested: 4, available: 1 },
    ])
    expect((await payload.findByID({ collection: 'stock-transfers', id: draft.id })).status).toBe('draft')
    expect(await qtyAt(payload, a, mainId)).toBe(5)
    expect(await qtyAt(payload, a, shopId)).toBe(0)
    expect(await qtyAt(payload, b, mainId)).toBe(1)
    expect(await movesOfDoc(payload, 'stock-transfers', draft.id)).toHaveLength(0)
  })

  it('сторно дзеркальне: залишки повертаються, product-costs не змінюється', async () => {
    const product = await newProduct()
    await stockUp(payload, product, mainId, 5, 1000)
    const draft = await createDraft([{ product, quantity: 3 }])
    await post(draft.id)

    const reversed = await reverse(draft.id)

    expect(reversed).toMatchObject({ status: 'reversed', reversalReason: 'moved by mistake' })
    expect(await qtyAt(payload, product, mainId)).toBe(5)
    expect(await qtyAt(payload, product, shopId)).toBe(0)
    expect(await costOf(payload, product)).toEqual({ qty: 5, valueBani: 1000 })

    const moves = await movesOfDoc(payload, 'stock-transfers', draft.id)
    const reversals = moves.filter((move) => move.moveType === 'reversal')
    expect(reversals).toHaveLength(2)
    expect(reversals.every((move) => move.reversalOf && move.valueDeltaBani === 0)).toBe(true)
    expect(reversals.every((move) => move.date === reversed.reversedAt)).toBe(true)
    expect(moves.reduce((sum, move) => sum + move.qtyDelta, 0)).toBe(0)
  })

  it('сторно відхилене, якщо переміщене вже розійшлося зі складу-приймача', async () => {
    const product = await newProduct()
    await stockUp(payload, product, mainId, 5, 1000)
    const draft = await createDraft([{ product, quantity: 3 }])
    await post(draft.id)

    // З магазину продано 2 з 3 переміщених.
    await sellFrom(payload, product, shopId, 2)

    await expect(reverse(draft.id)).rejects.toBeInstanceOf(InsufficientStockError)
    expect((await payload.findByID({ collection: 'stock-transfers', id: draft.id })).status).toBe('posted')
    expect(await qtyAt(payload, product, shopId)).toBe(1)
    expect(await qtyAt(payload, product, mainId)).toBe(2)
  })

  it('проведене переміщення не редагується й не видаляється, доступ лише admin', async () => {
    const product = await newProduct()
    await stockUp(payload, product, mainId, 2, 200)
    const draft = await createDraft([{ product, quantity: 1 }])
    await post(draft.id)

    await expect(
      payload.update({ collection: 'stock-transfers', id: draft.id, data: { comment: 'x' }, ...asAdmin }),
    ).rejects.toThrow()
    await expect(payload.delete({ collection: 'stock-transfers', id: draft.id, ...asAdmin })).rejects.toThrow()

    const customer = { id: 'c', roles: ['customer'], collection: 'users' } as unknown as AuthUser
    await expect(
      payload.find({ collection: 'stock-transfers', user: customer, overrideAccess: false }),
    ).rejects.toThrow()
  })
})
