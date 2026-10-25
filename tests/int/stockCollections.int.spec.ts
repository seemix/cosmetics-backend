import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { User } from '@/payload-types'

import { TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let productId: string
let otherProductId: string
let warehouseId: string
let otherWarehouseId: string

const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as unknown as User
const admin = asUser(['admin'])
const customer = asUser(['customer'])

const tag = `STK-${Date.now()}`
const created: Array<{ collection: 'stock-moves' | 'stock-balances' | 'product-costs' | 'warehouses'; id: number | string }> = []

const track = <T extends { id: number | string }>(collection: (typeof created)[number]['collection'], doc: T) => {
  created.push({ collection, id: doc.id })
  return doc
}

const balance = async (product: string, warehouse: string, qty = 5) =>
  track(
    'stock-balances',
    await payload.create({ collection: 'stock-balances', data: { product, warehouse, qty } }),
  )

const indexesOf = async (slug: string) => {
  const model = payload.db.collections[slug]
  await model.init()
  return model.collection.indexes()
}

describe('A5: журнал і кеш залишків', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)

    const brand = await data.brand()
    productId = String((await data.product({ brand: brand.id, retailPrice: 100 })).id)
    otherProductId = String((await data.product({ brand: brand.id, retailPrice: 100 })).id)

    warehouseId = String(
      track('warehouses', await payload.create({ collection: 'warehouses', data: { name: `${tag} A`, code: `${tag}-a` } })).id,
    )
    otherWarehouseId = String(
      track('warehouses', await payload.create({ collection: 'warehouses', data: { name: `${tag} B`, code: `${tag}-b` } })).id,
    )
  })

  afterAll(async () => {
    for (const { collection, id } of created.reverse()) {
      await payload.delete({ collection, id })
    }
    await data.cleanup()
  })

  describe('доступ', () => {
    const slugs = ['stock-moves', 'stock-balances', 'product-costs'] as const

    it.each(slugs)('%s: create/update/delete заборонені навіть admin', async (collection) => {
      const doc = await (collection === 'stock-balances'
        ? balance(productId, warehouseId)
        : collection === 'product-costs'
          ? payload.create({ collection, data: { product: productId, qty: 0, valueBani: 0 } }).then((d) => track(collection, d))
          : payload
              .create({
                collection,
                data: {
                  date: new Date().toISOString(),
                  product: productId,
                  warehouse: warehouseId,
                  qtyDelta: 1,
                  valueDeltaBani: 100,
                  moveType: 'opening',
                  docCollection: 'test',
                  docId: tag,
                },
              })
              .then((d) => track(collection, d)))

      await expect(
        payload.create({ collection, data: {} as never, overrideAccess: false, user: admin }),
      ).rejects.toThrow()
      await expect(
        payload.update({ collection, id: doc.id, data: {} as never, overrideAccess: false, user: admin }),
      ).rejects.toThrow()
      await expect(
        payload.delete({ collection, id: doc.id, overrideAccess: false, user: admin }),
      ).rejects.toThrow()

      // Документ не змінився й не зник.
      await expect(payload.findByID({ collection, id: doc.id })).resolves.toBeDefined()
    })

    it.each(slugs)('%s: читає admin, не читають customer і гість', async (collection) => {
      const read = (user: User | null) => payload.find({ collection, overrideAccess: false, user })

      await expect(read(admin)).resolves.toBeDefined()
      await expect(read(customer)).rejects.toThrow()
      await expect(read(null)).rejects.toThrow()
    })
  })

  describe('індекси в тестовій БД', () => {
    const keysOf = (indexes: Array<{ key: Record<string, unknown>; unique?: boolean }>, ...fields: string[]) =>
      indexes.find((index) => JSON.stringify(Object.keys(index.key)) === JSON.stringify(fields))

    it('stock-balances: uniq {product, variant, warehouse}', async () => {
      const index = keysOf(await indexesOf('stock-balances'), 'product', 'variant', 'warehouse')

      expect(index?.unique).toBe(true)
    })

    it('stock-moves: {product, warehouse, date}, {docCollection, docId}, {date, moveType}', async () => {
      const indexes = await indexesOf('stock-moves')

      expect(keysOf(indexes, 'product', 'warehouse', 'date')).toBeDefined()
      expect(keysOf(indexes, 'docCollection', 'docId')).toBeDefined()
      expect(keysOf(indexes, 'date', 'moveType')).toBeDefined()
    })

    it('product-costs: unique product', async () => {
      const index = keysOf(await indexesOf('product-costs'), 'product')

      expect(index?.unique).toBe(true)
    })

    it('дубль товар × склад (без варіанта) відхиляється, інший склад і товар дозволені', async () => {
      await balance(otherProductId, otherWarehouseId)

      await expect(
        payload.create({
          collection: 'stock-balances',
          data: { product: otherProductId, warehouse: otherWarehouseId, qty: 1 },
        }),
      ).rejects.toThrow()

      // Той самий товар на іншому складі й інший товар на тому самому складі дозволені.
      await expect(balance(otherProductId, warehouseId)).resolves.toBeDefined()
      await expect(balance(productId, otherWarehouseId)).resolves.toBeDefined()
    })

    it('другий product-costs для товару відхиляється', async () => {
      const existing = await payload.find({ collection: 'product-costs', where: { product: { equals: otherProductId } } })
      if (existing.docs.length === 0) {
        track('product-costs', await payload.create({ collection: 'product-costs', data: { product: otherProductId, qty: 1, valueBani: 100 } }))
      }

      await expect(
        payload.create({ collection: 'product-costs', data: { product: otherProductId, qty: 2, valueBani: 200 } }),
      ).rejects.toThrow()
    })
  })

  describe('валідація', () => {
    it('qty ≥ 0 і ціле', async () => {
      const create = (qty: number) =>
        payload.create({ collection: 'stock-balances', data: { product: otherProductId, warehouse: otherWarehouseId, qty } })

      await expect(create(-1)).rejects.toThrow()
      await expect(create(1.5)).rejects.toThrow()
    })

    it('valueDeltaBani має бути цілим', async () => {
      await expect(
        payload.create({
          collection: 'stock-moves',
          data: {
            date: new Date().toISOString(),
            product: productId,
            warehouse: warehouseId,
            qtyDelta: 1,
            valueDeltaBani: 10.5,
            moveType: 'opening',
            docCollection: 'test',
            docId: tag,
          },
        }),
      ).rejects.toThrow()
    })

    it('avgCostBani = valueBani / qty', async () => {
      const product = (await payload.find({ collection: 'product-costs', where: { product: { equals: otherProductId } } })).docs[0]
      await payload.update({ collection: 'product-costs', id: product.id, data: { qty: 14, valueBani: 173735 } })

      const doc = await payload.findByID({ collection: 'product-costs', id: product.id })

      expect(doc.avgCostBani).toBeCloseTo(173735 / 14, 6)
    })
  })
})
