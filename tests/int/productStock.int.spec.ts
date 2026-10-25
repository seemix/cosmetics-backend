import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getProductStock } from '@/endpoints/getProductStock'
import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { cleanupStock, stockUp } from './helpers/stock'

let payload: Payload
let data: TestData
let brandId: string
let mainId: string
let shopId: string

const tag = `PSTK-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []

const newProduct = async () => {
  const id = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
  products.push(id)
  return id
}

const callEndpoint = async (id: string, roles?: Array<'admin' | 'customer'>) => {
  const req = await createLocalReq(
    { user: roles ? ({ id: 'u', roles, collection: 'users' } as never) : undefined },
    payload,
  )
  req.routeParams = { id }
  const response = await getProductStock.handler(req)

  return { status: response.status, body: await response.json() }
}

describe('A14: залишок у картці товару', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    brandId = String((await data.brand()).id)

    // sortOrder задає порядок рядків у панелі.
    const main = await payload.create({
      collection: 'warehouses',
      data: { name: `${tag} Main`, code: `${tag}-main`, sortOrder: 1 },
    })
    const shop = await payload.create({
      collection: 'warehouses',
      data: { name: `${tag} Shop`, code: `${tag}-shop`, sortOrder: 2 },
    })
    warehouses.push(String(main.id), String(shop.id))
    ;[mainId, shopId] = warehouses
  })

  afterAll(async () => {
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  describe('поле ui', () => {
    const stockPanel = () =>
      payload.collections.products.config.fields.find((field) => 'name' in field && field.name === 'stockPanel')

    it('має тип ui із компонентом панелі', () => {
      expect(stockPanel()).toMatchObject({
        type: 'ui',
        admin: { components: { Field: '@/components/StockPanel/Field#StockPanel' } },
      })
    })

    it('не потрапляє у відповіді API: ні Local API, ні публічні ендпоінти', async () => {
      const product = await newProduct()
      await stockUp(payload, product, mainId, 3, 300)

      const doc = await payload.findByID({ collection: 'products', id: product, depth: 0 })
      const list = await payload.find({ collection: 'products', where: { id: { equals: product } }, depth: 0 })

      expect(doc).not.toHaveProperty('stockPanel')
      expect(list.docs[0]).not.toHaveProperty('stockPanel')
      expect(JSON.stringify(doc)).not.toMatch(/stockPanel/)
    })

    it('показується лише admin', () => {
      const condition = (stockPanel() as { admin: { condition: (...args: unknown[]) => boolean } }).admin.condition
      const as = (roles: string[]) => condition({}, {}, { user: { roles } })

      expect(as(['admin'])).toBe(true)
      expect(as(['customer'])).toBe(false)
      expect(condition({}, {}, { user: null })).toBe(false)
    })
  })

  describe('GET /stock/product/:id', () => {
    it('перевіряє роль: гість 401, customer 403', async () => {
      const product = await newProduct()
      await stockUp(payload, product, mainId, 3, 300)

      expect(await callEndpoint(product)).toMatchObject({ status: 401 })
      const denied = await callEndpoint(product, ['customer'])
      expect(denied.status).toBe(403)
      // Собівартість не витікає у відмову.
      expect(JSON.stringify(denied.body)).not.toMatch(/valueBani|avgCostBani/)
    })

    it('admin: залишки по складах у порядку sortOrder, середня і вартість', async () => {
      const product = await newProduct()
      await stockUp(payload, product, shopId, 2, 1000)
      await stockUp(payload, product, mainId, 12, 172735)

      const { status, body } = await callEndpoint(product, ['admin'])

      expect(status).toBe(200)
      expect(body.productId).toBe(product)
      expect(body.warehouses).toEqual([
        { id: mainId, name: `${tag} Main`, code: `${tag}-main`, qty: 12 },
        { id: shopId, name: `${tag} Shop`, code: `${tag}-shop`, qty: 2 },
      ])
      expect(body.totalQty).toBe(14)
      expect(body.valueBani).toBe(173735)
      expect(body.avgCostBani).toBeCloseTo(173735 / 14, 6)
      expect(body.lastPurchaseUnitCostBani).toBeNull()
    })

    it('товар без залишків: порожній список, нулі', async () => {
      const product = await newProduct()

      const { status, body } = await callEndpoint(product, ['admin'])

      expect(status).toBe(200)
      expect(body).toEqual({
        productId: product,
        warehouses: [],
        totalQty: 0,
        valueBani: 0,
        avgCostBani: 0,
        lastPurchaseUnitCostBani: null,
      })
    })

    it('невалідний id 400, невідомий товар 404', async () => {
      expect(await callEndpoint('not-an-id', ['admin'])).toMatchObject({ status: 400 })
      expect(await callEndpoint('0123456789abcdef01234567', ['admin'])).toMatchObject({ status: 404 })
    })
  })
})
