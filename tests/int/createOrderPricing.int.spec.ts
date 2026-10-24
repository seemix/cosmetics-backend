import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { validatePromo } from '@/collections/Carts/endpoints/validatePromo'

import { makeRequest, TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'

let payload: Payload
let data: TestData

const orderBody = (productId: string | number, quantity: number, promoCode?: string) => ({
  items: [{ product: productId, quantity }],
  shippingAddress,
  promoCode,
})

describe('createOrder: промокод і оптовий покупець', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  describe('промокод', () => {
    it('знижує товари вказаного бренду, зберігає знижку й код', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1000 })
      const promo = await data.promo({ brands: [brand.id], percent: 10 })

      const { status, body } = await callCreateOrder(payload, {
        body: orderBody(product.id, 2, promo.code),
      })

      expect(status).toBe(201)
      const order = await loadOrder(payload, data, body.order.id)
      expect(order.promoCodeApplied).toBe(promo.code)
      expect(order.discount).toBe(200)
      expect(order.total).toBe(1800)
    })

    it('не знижує товари інших брендів, але код записується', async () => {
      const promoBrand = await data.brand()
      const otherBrand = await data.brand()
      const product = await data.product({ brand: otherBrand.id, retailPrice: 1000 })
      const promo = await data.promo({ brands: [promoBrand.id], percent: 10 })

      const { body } = await callCreateOrder(payload, { body: orderBody(product.id, 1, promo.code) })

      const order = await loadOrder(payload, data, body.order.id)
      expect(order.total).toBe(1000)
      expect(order.discount ?? null).toBeNull()
      expect(order.promoCodeApplied).toBe(promo.code)
    })

    // T20: порожній список брендів промокоду означає «усі бренди», як і в кошику.
    it('промокод без брендів знижує товари будь-якого бренду', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1000 })
      const promo = await data.promo({ percent: 10 })

      const { body } = await callCreateOrder(payload, { body: orderBody(product.id, 1, promo.code) })

      const order = await loadOrder(payload, data, body.order.id)
      expect(order.total).toBe(900)
      expect(order.discount).toBe(100)
      expect(order.promoCodeApplied).toBe(promo.code)
    })

    it('промокод без брендів: знижка в /validate-promo і в замовленні однакова', async () => {
      const first = await data.product({ brand: (await data.brand()).id, retailPrice: 1000 })
      const second = await data.product({ brand: (await data.brand()).id, retailPrice: 333 })
      const promo = await data.promo({ percent: 15 })

      const response = (await validatePromo.handler(
        makeRequest(payload, {
          body: {
            promoCode: promo.code,
            items: [
              { productId: first.id, quantity: 2 },
              { productId: second.id, quantity: 3 },
            ],
          },
        }),
      )) as Response
      const cart = (await response.json()) as { promoDiscount: number; subtotal: number }

      const { body } = await callCreateOrder(payload, {
        body: {
          items: [
            { product: first.id, quantity: 2 },
            { product: second.id, quantity: 3 },
          ],
          shippingAddress,
          promoCode: promo.code,
        },
      })
      const order = await loadOrder(payload, data, body.order.id)

      expect(cart.promoDiscount).toBeGreaterThan(0)
      expect(order.discount).toBe(cart.promoDiscount)
      expect(order.total).toBe(cart.subtotal)
    })
  })

  describe('оптовий покупець', () => {
    it('бачить оптову ціну', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1200, wholesalePrice: 1000 })
      const user = await data.user({ wholesale: true })

      const { status, body } = await callCreateOrder(payload, {
        user,
        body: orderBody(product.id, 2),
      })

      expect(status).toBe(201)
      const order = await loadOrder(payload, data, body.order.id)
      expect(order.total).toBe(2000)
      expect(order.items?.[0]?.price).toBe(1000)
    })

    it('оптовий промокод діє для оптовика', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1200, wholesalePrice: 1000 })
      const user = await data.user({ wholesale: true })
      const promo = await data.promo({ wholesale: true, brands: [brand.id], percent: 10 })

      const { status, body } = await callCreateOrder(payload, {
        user,
        body: orderBody(product.id, 1, promo.code),
      })

      expect(status).toBe(201)
      const order = await loadOrder(payload, data, body.order.id)
      expect(order.promoCodeApplied).toBe(promo.code)
      expect(order.discount).toBe(100)
      expect(order.total).toBe(900)
    })

    // Хук populatePricesAndTotal (beforeChange) перераховує ціну позиції за повною оптовою
    // ціною й затирає брендову знижку, яку handler порахував (900 за одиницю).
    // Тест фіксує ПОТОЧНУ поведінку; це розбіжність handler і хука, а не вимога.
    it('[поточна поведінка] хук затирає брендову знижку оптовика', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1200, wholesalePrice: 1000 })
      const user = await data.user({
        wholesale: true,
        brandDiscounts: [{ brand: brand.id, discountPercent: 10 }],
      })

      const { status, body } = await callCreateOrder(payload, {
        user,
        body: orderBody(product.id, 2),
      })

      expect(status).toBe(201)
      const order = await loadOrder(payload, data, body.order.id)
      expect(order.items?.[0]?.price).toBe(1000)
      expect(order.total).toBe(2000)
    })
  })
})
