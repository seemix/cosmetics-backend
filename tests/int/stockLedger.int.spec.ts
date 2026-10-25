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
import type { StockMove } from '@/payload-types'
import {
  AlreadyRevertedError,
  InsufficientStockError,
  isTransientTransactionError,
  StockTransactionRequiredError,
} from '@/services/stock/errors'
import { issue, receive, revert, transfer } from '@/services/stock/stockLedger.service'

import { TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let brandId: string
let warehouseId: string
let otherWarehouseId: string

const tag = `LDG-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const doc = (id: string) => ({ collection: 'test-docs', id: `${tag}-${id}`, number: `TST-${id}` })

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

/** Виконує `fn` в окремій закоміченій транзакції, як це робитиме проведення документа. */
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

const cost = async (product: string) =>
  (await payload.find({ collection: 'product-costs', where: { product: { equals: product } }, depth: 0 })).docs[0]

const qtyAt = async (product: string, warehouse: string) =>
  (
    await payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouse } },
      depth: 0,
    })
  ).docs[0]?.qty ?? 0

const movesOf = async (product: string) =>
  (
    await payload.find({
      collection: 'stock-moves',
      where: { product: { equals: product } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

const stockAt = (product: string, qty: number, valueBani: number, warehouse = warehouseId) =>
  inTransaction((req) =>
    receive(req, { doc: doc('opening'), moveType: 'opening', lines: [{ product, warehouse, qty, valueBani }] }),
  )

describe('A6: сервіс руху запасів', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    brandId = String((await data.brand()).id)

    for (const code of ['a', 'b']) {
      const warehouse = await payload.create({ collection: 'warehouses', data: { name: `${tag} ${code}`, code: `${tag}-${code}` } })
      warehouses.push(String(warehouse.id))
    }
    ;[warehouseId, otherWarehouseId] = warehouses
  })

  afterAll(async () => {
    const byProduct = { product: { in: products } }
    await payload.delete({ collection: 'stock-moves', where: byProduct })
    await payload.delete({ collection: 'stock-balances', where: byProduct })
    await payload.delete({ collection: 'product-costs', where: byProduct })
    await payload.delete({ collection: 'warehouses', where: { id: { in: warehouses } } })
    await data.cleanup()
  })

  it('без відкритої транзакції кидає помилку й нічого не пише', async () => {
    const product = await newProduct()
    const req = await createLocalReq({}, payload)

    await expect(
      receive(req, { doc: doc('x'), moveType: 'opening', lines: [{ product, warehouse: warehouseId, qty: 1, valueBani: 100 }] }),
    ).rejects.toBeInstanceOf(StockTransactionRequiredError)
    await expect(issue(req, { doc: doc('x'), moveType: 'sale', lines: [] })).rejects.toBeInstanceOf(
      StockTransactionRequiredError,
    )
    expect(await qtyAt(product, warehouseId)).toBe(0)
    expect(await movesOf(product)).toHaveLength(0)
  })

  it('приклад з розд. 5.3: прихід, продаж, скасування, продаж решти', async () => {
    const product = await newProduct()

    // Початковий залишок 4 шт. на 46 000 бані.
    await stockAt(product, 4, 46_000)
    expect(await cost(product)).toMatchObject({ qty: 4, valueBani: 46_000 })

    // Прихід 10 шт., landed 127 735.
    await inTransaction((req) =>
      receive(req, {
        doc: doc('pur'),
        moveType: 'purchase',
        lines: [{ product, warehouse: warehouseId, qty: 10, valueBani: 127_735 }],
      }),
    )
    expect(await cost(product)).toMatchObject({ qty: 14, valueBani: 173_735, lastPurchaseUnitCostBani: 12_773.5 })
    expect((await cost(product)).avgCostBani).toBeCloseTo(12_409.64, 2)

    // Продаж 3 шт.: собівартість round(173735 × 3 / 14) = 37 229.
    const [sale] = await inTransaction((req) =>
      issue(req, { doc: doc('sale-1'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 3 }] }),
    )
    expect(sale).toMatchObject({ qtyDelta: -3, valueDeltaBani: -37_229, moveType: 'sale' })
    expect(sale.unitCostBani).toBeCloseTo(173_735 / 14, 6)
    expect(await cost(product)).toMatchObject({ qty: 11, valueBani: 136_506 })

    // Скасування повертає рівно 37 229.
    const [cancel] = await inTransaction((req) =>
      revert(req, { doc: doc('sale-1'), moves: [sale], moveType: 'sale_cancel' }),
    )
    expect(cancel).toMatchObject({ qtyDelta: 3, valueDeltaBani: 37_229, moveType: 'sale_cancel', reversalOf: sale.id })
    expect(await cost(product)).toMatchObject({ qty: 14, valueBani: 173_735 })
    expect(await qtyAt(product, warehouseId)).toBe(14)

    // Без скасування: знову продаж 3 шт. (11 / 136 506), потім решта 11 шт. обнуляє вартість.
    await inTransaction((req) =>
      issue(req, { doc: doc('sale-2'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 3 }] }),
    )
    expect(await cost(product)).toMatchObject({ qty: 11, valueBani: 136_506 })

    const [last] = await inTransaction((req) =>
      issue(req, { doc: doc('sale-3'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 11 }] }),
    )
    expect(last.valueDeltaBani).toBe(-136_506)
    expect(await cost(product)).toMatchObject({ qty: 0, valueBani: 0 })
    expect(await qtyAt(product, warehouseId)).toBe(0)

    // Журнал сходиться з кешем.
    const moves = await movesOf(product)
    expect(moves.map((move) => move.moveType)).toEqual(['opening', 'purchase', 'sale', 'sale_cancel', 'sale', 'sale'])
    expect(moves.reduce((sum, move) => sum + move.qtyDelta, 0)).toBe(0)
    expect(moves.reduce((sum, move) => sum + move.valueDeltaBani, 0)).toBe(0)
  })

  it('останнє списання з дробовою середньою забирає рівно залишок вартості', async () => {
    const product = await newProduct()
    await stockAt(product, 3, 1_000)

    const sell = (qty: number) =>
      inTransaction((req) =>
        issue(req, { doc: doc('frac'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty }] }),
      )

    expect((await sell(1))[0].valueDeltaBani).toBe(-333)
    expect((await sell(1))[0].valueDeltaBani).toBe(-334)
    expect((await sell(1))[0].valueDeltaBani).toBe(-333)
    expect(await cost(product)).toMatchObject({ qty: 0, valueBani: 0 })
  })

  it('нестача: InsufficientStockError з деталями по всіх рядках, нічого не змінюється', async () => {
    const product = await newProduct()
    const other = await newProduct()
    await stockAt(product, 2, 200)

    const error = await inTransaction((req) =>
      issue(req, {
        doc: doc('short'),
        moveType: 'sale',
        lines: [
          { product, warehouse: warehouseId, qty: 5 },
          { product: other, warehouse: warehouseId, qty: 1 },
        ],
      }),
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(InsufficientStockError)
    expect((error as InsufficientStockError).status).toBe(409)
    expect((error as InsufficientStockError).items).toEqual(
      expect.arrayContaining([
        { product, warehouse: warehouseId, requested: 5, available: 2 },
        { product: other, warehouse: warehouseId, requested: 1, available: 0 },
      ]),
    )
    expect(await qtyAt(product, warehouseId)).toBe(2)
    expect(await cost(product)).toMatchObject({ qty: 2, valueBani: 200 })
    expect(await movesOf(product)).toHaveLength(1)
  })

  it('нестача на одному рядку відкочує вже списані рядки того самого виклику', async () => {
    const product = await newProduct()
    const other = await newProduct()
    await stockAt(product, 5, 500)
    await stockAt(other, 1, 100)

    await expect(
      inTransaction((req) =>
        issue(req, {
          doc: doc('partial'),
          moveType: 'sale',
          lines: [
            { product, warehouse: warehouseId, qty: 2 },
            { product: other, warehouse: warehouseId, qty: 2 },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError)

    expect(await qtyAt(product, warehouseId)).toBe(5)
    expect(await qtyAt(other, warehouseId)).toBe(1)
  })

  it('дві паралельні issue на останню одиницю: рівно одна успішна', async () => {
    const product = await newProduct()
    await stockAt(product, 1, 1_000)

    const sell = (id: string) =>
      inTransaction((req) =>
        issue(req, { doc: doc(id), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 1 }] }),
      )

    const results = await Promise.allSettled([sell('race-1'), sell('race-2')])
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(reason instanceof InsufficientStockError || isTransientTransactionError(reason)).toBe(true)

    expect(await qtyAt(product, warehouseId)).toBe(0)
    expect(await cost(product)).toMatchObject({ qty: 0, valueBani: 0 })
    expect((await movesOf(product)).filter((move) => move.moveType === 'sale')).toHaveLength(1)
  })

  it('після відкату транзакції кеш і журнал незмінні', async () => {
    const product = await newProduct()
    await stockAt(product, 4, 46_000)

    const req = await createLocalReq({}, payload)
    await initTransaction(req)
    await receive(req, {
      doc: doc('rollback'),
      moveType: 'purchase',
      lines: [{ product, warehouse: warehouseId, qty: 10, valueBani: 127_735 }],
    })
    await issue(req, { doc: doc('rollback'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 7 }] })
    await transfer(req, { doc: doc('rollback'), from: warehouseId, to: otherWarehouseId, lines: [{ product, qty: 2 }] })
    await killTransaction(req)

    expect(await cost(product)).toMatchObject({ qty: 4, valueBani: 46_000 })
    expect(await qtyAt(product, warehouseId)).toBe(4)
    expect(await qtyAt(product, otherWarehouseId)).toBe(0)
    expect(await movesOf(product)).toHaveLength(1)
  })

  it('transfer: залишки між складами, середня незмінна, два рухи з нульовою вартістю', async () => {
    const product = await newProduct()
    await stockAt(product, 5, 1_000)

    const moves = await inTransaction((req) =>
      transfer(req, { doc: doc('trf'), from: warehouseId, to: otherWarehouseId, lines: [{ product, qty: 3 }] }),
    )

    expect(moves.map((move) => [move.moveType, move.qtyDelta, move.valueDeltaBani])).toEqual([
      ['transfer_out', -3, 0],
      ['transfer_in', 3, 0],
    ])
    expect(await qtyAt(product, warehouseId)).toBe(2)
    expect(await qtyAt(product, otherWarehouseId)).toBe(3)
    expect(await cost(product)).toMatchObject({ qty: 5, valueBani: 1_000 })

    // Нестача на складі-джерелі.
    await expect(
      inTransaction((req) =>
        transfer(req, { doc: doc('trf-2'), from: warehouseId, to: otherWarehouseId, lines: [{ product, qty: 3 }] }),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError)

    // Сторно переміщення повертає залишки, середню не чіпає.
    await inTransaction((req) => revert(req, { doc: doc('trf'), moves }))
    expect(await qtyAt(product, warehouseId)).toBe(5)
    expect(await qtyAt(product, otherWarehouseId)).toBe(0)
    expect(await cost(product)).toMatchObject({ qty: 5, valueBani: 1_000 })
  })

  it('revert приходу: умовне списання, повтор заборонений, нестача відхиляє', async () => {
    const product = await newProduct()
    await stockAt(product, 4, 46_000)

    const purchase = await inTransaction((req) =>
      receive(req, {
        doc: doc('pur-r'),
        moveType: 'purchase',
        lines: [{ product, warehouse: warehouseId, qty: 10, valueBani: 127_735 }],
      }),
    )

    // Продано 12: на складі 2, сторно приходу 10 шт. неможливе.
    let sold: StockMove[] = await inTransaction((req) =>
      issue(req, { doc: doc('sale-r'), moveType: 'sale', lines: [{ product, warehouse: warehouseId, qty: 12 }] }),
    )
    await expect(inTransaction((req) => revert(req, { doc: doc('pur-r'), moves: purchase }))).rejects.toBeInstanceOf(
      InsufficientStockError,
    )
    expect(await qtyAt(product, warehouseId)).toBe(2)

    // Після скасування продажу сторно проходить і повертає кеш у вихідний стан.
    sold = await inTransaction((req) => revert(req, { doc: doc('sale-r'), moves: sold, moveType: 'sale_cancel' }))
    expect(sold).toHaveLength(1)
    const [reversal] = await inTransaction((req) => revert(req, { doc: doc('pur-r'), moves: purchase }))

    expect(reversal).toMatchObject({ qtyDelta: -10, valueDeltaBani: -127_735, moveType: 'reversal' })
    expect(await cost(product)).toMatchObject({ qty: 4, valueBani: 46_000 })

    await expect(inTransaction((req) => revert(req, { doc: doc('pur-r'), moves: purchase }))).rejects.toBeInstanceOf(
      AlreadyRevertedError,
    )
  })
})
