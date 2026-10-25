import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getSingleProduct } from '@/collections/Products/endpoints/getSingleProduct'
import { searchProducts } from '@/collections/Products/endpoints/searchProducts'
import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { cleanupStock, stockUp } from './helpers/stock'

let payload: Payload
let data: TestData
let brandId: string
let webWarehouse: string
let otherWarehouse: string
let previousSettings: Record<string, unknown>

const tag = `INST-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const setStockControl = (enabled: boolean) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: enabled } as never })

const newProduct = async () => {
  const doc = await data.product({ brand: brandId, retailPrice: 100, subtitle: tag })
  products.push(String(doc.id))
  return String(doc.id)
}

const request = async (extra: Record<string, unknown>) => {
  const req = await createLocalReq({}, payload)
  req.locale = 'ru'
  Object.assign(req, extra)
  return req
}

const single = async (id: string) => {
  const response = await getSingleProduct.handler(await request({ routeParams: { identifier: id } }))
  return response.json()
}

const search = async () => {
  const response = await searchProducts.handler(await request({ query: { q: tag, limit: '50' } }))
  return response.json() as Promise<{ products: Array<{ id: string; inStock: boolean }> }>
}

describe('S2.7: inStock у відповідях товарів', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    brandId = String((await data.brand()).id)

    for (const code of ['web', 'other']) {
      const doc = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(doc.id))
    }
    ;[webWarehouse, otherWarehouse] = warehouses

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { stockControlEnabled: true, defaultWebWarehouse: webWarehouse } as never,
    })
  })

  afterAll(async () => {
    await setStockControl(previousSettings.stockControlEnabled === true)
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('залишок на складі сайту ⇒ true; нуль або інший склад ⇒ false', async () => {
    const available = await newProduct()
    const empty = await newProduct()
    const elsewhere = await newProduct()
    await stockUp(payload, available, webWarehouse, 2, 20000)
    await stockUp(payload, elsewhere, otherWarehouse, 5, 50000)

    expect((await single(available)).inStock).toBe(true)
    expect((await single(empty)).inStock).toBe(false)
    expect((await single(elsewhere)).inStock).toBe(false)
  })

  it('пошук: один запит stock-balances на сторінку, прапорець у кожному товарі', async () => {
    const find = vi.spyOn(payload, 'find')
    const result = await search()
    const balanceQueries = find.mock.calls.filter(([args]) => args.collection === 'stock-balances')
    find.mockRestore()

    expect(balanceQueries).toHaveLength(1)
    const flags = Object.fromEntries(result.products.map((product) => [String(product.id), product.inStock]))
    expect(Object.keys(flags).sort()).toEqual([...products].sort())
    expect(Object.values(flags).filter(Boolean)).toHaveLength(1)
  })

  it('облік вимкнено: усі товари inStock = true, запиту до кешу немає', async () => {
    await setStockControl(false)
    const find = vi.spyOn(payload, 'find')
    const result = await search()
    const balanceQueries = find.mock.calls.filter(([args]) => args.collection === 'stock-balances')
    find.mockRestore()

    expect(balanceQueries).toHaveLength(0)
    expect(result.products.every((product) => product.inStock)).toBe(true)
    await setStockControl(true)
  })
})
