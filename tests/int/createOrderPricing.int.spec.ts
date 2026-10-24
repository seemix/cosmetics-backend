import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
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

    // Відомий баг з docs/plan.md: в applyPromoDiscount порожній список брендів означає
    // «усі бренди», а в createOrder — «жодного». Тест фіксує ПОТОЧНУ поведінку;
    // коли баг виправлять, очікування треба змінити на знижку 10%.
    it('[відомий баг] промокод без брендів не дає знижки в замовленні', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 1000 })
      const promo = await data.promo({ percent: 10 })

      const { body } = await callCreateOrder(payload, { body: orderBody(product.id, 1, promo.code) })

      const order = await loadOrder(payload, data, body.order.id)
      expect(order.total).toBe(1000)
      expect(order.discount ?? null).toBeNull()
      expect(order.promoCodeApplied).toBe(promo.code)
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
