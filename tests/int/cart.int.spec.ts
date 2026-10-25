import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { fetchGuestCart } from '@/collections/Carts/services/fetchGuestCart.service'
import { buildProductsMap, normalizeCartResponse } from '@/collections/Carts/services/normalizedCart'

import { makeRequest, TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let req: PayloadRequest

describe('кошик', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    req = makeRequest(payload)
  })

  afterAll(async () => {
    await data.cleanup()
  })

  describe('priceHook (ціни та subtotal кошика)', () => {
    it('роздрібний клієнт: ціна позиції і subtotal за роздрібною ціною', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 300, wholesalePrice: 250 })
      const user = await data.user()

      const cart = await data.cart({ customer: user.id, items: [{ product: product.id, quantity: 2 }] })

      expect(cart.items?.[0]?.price).toBe(300)
      expect(cart.items?.[0]?.subtotal).toBe(600)
      expect(cart.subtotal).toBe(600)
    })

    it('оптовик: оптова ціна з брендовою знижкою', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1200, wholesalePrice: 1000 })
      const user = await data.user({
        wholesale: true,
        brandDiscounts: [{ brand: brand.id, discountPercent: 10 }],
      })

      const cart = await data.cart({ customer: user.id, items: [{ product: product.id, quantity: 3 }] })

      expect(cart.items?.[0]?.price).toBe(900)
      expect(cart.subtotal).toBe(2700)
    })

    it('subtotal сумує кілька позицій', async () => {
      const brand = await data.brand()
      const first = await data.product({ brand: brand.id, retailPrice: 100 })
      const second = await data.product({ brand: brand.id, retailPrice: 40 })
      const user = await data.user()

      const cart = await data.cart({
        customer: user.id,
        items: [
          { product: first.id, quantity: 2 },
          { product: second.id, quantity: 5 },
        ],
      })

      expect(cart.subtotal).toBe(400)
    })
  })

  describe('buildProductsMap', () => {
    it('повертає Map за id і пропускає невідомі', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100 })

      const map = await buildProductsMap(req, [product.id, '000000000000000000000000'], {
        locale: 'ru',
      })

      expect([...map.keys()]).toEqual([product.id])
      expect(map.get(product.id)?.retailPrice).toBe(100)
    })

    it('locale "all" повертає значення всіх локалей', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100, subtitle: 'Русский' })
      await payload.update({
        collection: 'products',
        id: product.id,
        locale: 'ro',
        data: { subtitle: 'Română' },
      })

      const map = await buildProductsMap(req, [product.id], { locale: 'all', depth: 2 })

      expect(map.get(product.id)?.subtitle).toEqual({ ru: 'Русский', ro: 'Română' })
    })

    it('порожній список id дає порожній Map', async () => {
      expect((await buildProductsMap(req, [], { locale: 'ru' })).size).toBe(0)
    })
  })

  describe('normalizeCartResponse', () => {
    it('нормалізує кошик з БД: id, бренд, ціна, підсумок і локалізований subtitle', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 300, subtitle: 'Русский' })
      await payload.update({
        collection: 'products',
        id: product.id,
        locale: 'ro',
        data: { subtitle: 'Română' },
      })
      const user = await data.user()
      const cart = await data.cart({ customer: user.id, items: [{ product: product.id, quantity: 2 }] })

      const ru = await normalizeCartResponse(req, cart, 'ru')
      const ro = await normalizeCartResponse(req, cart, 'ro')

      expect(ru.id).toBe(cart.id)
      expect(ru.subtotal).toBe(600)
      expect(ru.items).toHaveLength(1)
      expect(ru.items[0]).toMatchObject({
        id: product.id,
        title: product.title,
        brandId: brand.id,
        price: 300,
        quantity: 2,
      })
      expect(ru.items[0].subtitle).toBe('Русский')
      expect(ro.items[0].subtitle).toBe('Română')
    })
  })

  describe('fetchGuestCart', () => {
    it('порожній список повертає null', async () => {
      expect(await fetchGuestCart({ req, items: [] })).toBeNull()
    })

    it('рахує гостьовий кошик за роздрібною ціною і відкидає невідомі товари', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 200, wholesalePrice: 150 })

      const cart = await fetchGuestCart({
        req,
        items: [
          { productId: product.id, quantity: 3 },
          { productId: '000000000000000000000000', quantity: 1 },
        ],
        locale: 'ru',
      })

      expect(cart).toMatchObject({ id: 'preview', subtotal: 600 })
      expect(cart?.items).toHaveLength(1)
      expect(cart?.items[0]).toMatchObject({ id: product.id, price: 200, quantity: 3, brandId: brand.id })
    })
  })
})
