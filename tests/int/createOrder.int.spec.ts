import { getPayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'

let payload: Payload
let data: TestData

describe('createOrder: запит і роздрібне замовлення', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
  })

  afterEach(() => {
    vi.mocked(payload.sendEmail).mockClear()
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  describe('валідація запиту', () => {
    it('без позицій — 400', async () => {
      const { status, body } = await callCreateOrder(payload, { body: { shippingAddress } })

      expect(status).toBe(400)
      expect(body.error).toBe('Items are required')
    })

    it('без адреси доставки — 400', async () => {
      const { status, body } = await callCreateOrder(payload, {
        body: { items: [{ product: 'x', quantity: 1 }] },
      })

      expect(status).toBe(400)
      expect(body.error).toBe('Shipping address is required')
    })

    it('позиція без кількості — 400', async () => {
      const { status, body } = await callCreateOrder(payload, {
        body: { items: [{ product: 'x' }], shippingAddress },
      })

      expect(status).toBe(400)
      expect(body.error).toBe('Invalid item format')
    })

    it('невідомий промокод — 400 і замовлення не створюється', async () => {
      const before = (await payload.count({ collection: 'orders' })).totalDocs
      const { status, body } = await callCreateOrder(payload, {
        body: { items: [{ product: 'x', quantity: 1 }], shippingAddress, promoCode: 'NO-SUCH' },
      })

      expect(status).toBe(400)
      expect(body.error).toBe('Promo not found')
      expect((await payload.count({ collection: 'orders' })).totalDocs).toBe(before)
    })

    it('оптовий промокод для роздрібного гостя — 400', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100 })
      const promo = await data.promo({ wholesale: true, brands: [brand.id] })

      const { status, body } = await callCreateOrder(payload, {
        body: {
          items: [{ product: product.id, quantity: 1 }],
          shippingAddress,
          promoCode: promo.code,
        },
      })

      expect(status).toBe(400)
      expect(body.error).toBe('Promo not valid')
    })
  })

  describe('роздрібне замовлення', () => {
    it('рахує суму за роздрібною ціною і створює замовлення', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 500 })

      const { status, body } = await callCreateOrder(payload, {
        body: { items: [{ product: product.id, quantity: 3 }], shippingAddress },
      })

      expect(status).toBe(201)
      expect(body.success).toBe(true)
      expect(body.order.items).toHaveLength(1)
      expect(body.order.items[0]).toMatchObject({ quantity: 3, price: 500 })

      const order = await loadOrder(payload, data, body.order.id)
      expect(order.total).toBe(1500)
      expect(order.status).toBe('pending')
      expect(order.discount ?? null).toBeNull()
      expect(order.promoCodeApplied ?? null).toBeNull()
      expect(order.orderNumber).toBeTruthy()
    })

    it('сумує кілька позицій', async () => {
      const brand = await data.brand()
      const first = await data.product({ brand: brand.id, retailPrice: 100 })
      const second = await data.product({ brand: brand.id, retailPrice: 250 })

      const { status, body } = await callCreateOrder(payload, {
        body: {
          items: [
            { product: first.id, quantity: 2 },
            { product: second.id, quantity: 1 },
          ],
          shippingAddress,
        },
      })

      expect(status).toBe(201)
      expect((await loadOrder(payload, data, body.order.id)).total).toBe(450)
    })

    it('відправляє лист про нове замовлення', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100 })

      const { body } = await callCreateOrder(payload, {
        body: { items: [{ product: product.id, quantity: 1 }], shippingAddress },
      })
      await loadOrder(payload, data, body.order.id)

      expect(payload.sendEmail).toHaveBeenCalledTimes(1)
      expect(vi.mocked(payload.sendEmail).mock.calls[0][0]).toMatchObject({
        to: shippingAddress.email,
      })
    })

    it('прив’язує замовлення до авторизованого користувача', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100 })
      const user = await data.user()

      const { body } = await callCreateOrder(payload, {
        user,
        body: { items: [{ product: product.id, quantity: 1 }], shippingAddress },
      })

      expect((await loadOrder(payload, data, body.order.id)).customer).toBe(user.id)
    })

    it('номери замовлень унікальні', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: brand.id, retailPrice: 100 })
      const make = async () => {
        const { body } = await callCreateOrder(payload, {
          body: { items: [{ product: product.id, quantity: 1 }], shippingAddress },
        })
        return loadOrder(payload, data, body.order.id)
      }

      const first = await make()
      const second = await make()

      expect(first.orderNumber).not.toBe(second.orderNumber)
    })
  })

  describe('помилки', () => {
    it('неіснуючий товар дає 500, а не 404 (findByID кидає NotFound)', async () => {
      const { status, body } = await callCreateOrder(payload, {
        body: {
          items: [{ product: '000000000000000000000000', quantity: 1 }],
          shippingAddress,
        },
      })

      expect(status).toBe(500)
      expect(body).toEqual({ success: false, message: 'Failed to create order' })
    })
  })
})
