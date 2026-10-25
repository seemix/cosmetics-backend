import { initI18n } from '@payloadcms/translations'
import type { Endpoint, Payload, PayloadRequest } from 'payload'
import { getPayload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { addCartItem } from '@/collections/Carts/endpoints/addCartItem'
import { clearCart } from '@/collections/Carts/endpoints/clearCart'
import { getCartByUser } from '@/collections/Carts/endpoints/getCartByUser'
import { getGuestCart } from '@/collections/Carts/endpoints/getGuestCart'
import { mergeCart } from '@/collections/Carts/endpoints/mergeCart'
import { removeCartItem } from '@/collections/Carts/endpoints/removeCartItem'
import { updateCartItem } from '@/collections/Carts/endpoints/updateCartItem'
import { validatePromo } from '@/collections/Carts/endpoints/validatePromo'
import { getBrandInfo } from '@/collections/Brands/endpoints/getBrandInfo'
import { createOrder } from '@/collections/Orders/endpoints/createOrder'
import { getMyOrders } from '@/collections/Orders/endpoints/getMyOrders'
import { getPageBySlug } from '@/collections/Pages/endpoints/getPageBySlug'
import { getSinglePost } from '@/collections/Posts/endpoints/getSinglePost'
import { getSingleProduct } from '@/collections/Products/endpoints/getSingleProduct'
import { addFavoritesItem } from '@/collections/Users/endpoints/addFavoritesItem'
import { removeFavoritesItem } from '@/collections/Users/endpoints/removeFavoritesItem'
import { updateUserInfo } from '@/collections/Users/endpoints/updateUserInfo'
import { getProductStock } from '@/endpoints/getProductStock'
import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { shippingAddress, silenceSideEffects } from './helpers/orderCall'

/**
 * I2: відповіді публічних ендпоінтів не залежать від мови адмінки й не змінилися після перекладу.
 * Знімок `__snapshots__/publicApi.int.spec.ts.snap` знято на коміті до I2 (f9b5819).
 * Кожен виклик виконується з `req.t` трьох мов, тіла відповідей мають збігтися.
 */

let payload: Payload
let data: TestData

const languages = ['en', 'ru', 'ro'] as const
const NOT_ID = 'ffffffffffffffffffffffff'

/** Значення, що змінюються між запусками (ідентифікатори, дати, номери), замінюються на мітки. */
const VOLATILE_KEYS = new Set(['id', 'orderNumber', 'createdAt', 'updatedAt', 'slug', 'article', 'title'])

const stabilize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stabilize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, VOLATILE_KEYS.has(key) ? `<${key}>` : stabilize(inner)]),
    )
  }

  return value
}

type Options = {
  user?: unknown
  body?: unknown
  routeParams?: Record<string, string>
  searchParams?: Record<string, string>
}

const call = async (endpoint: Endpoint, language: (typeof languages)[number], options: Options = {}) => {
  const t = (await initI18n({ config: payload.config.i18n, context: 'api', language })).t
  const req = {
    payload,
    user: options.user ?? null,
    locale: 'ru',
    t,
    i18n: { t, language },
    json: async () => options.body,
    routeParams: options.routeParams,
    searchParams: new URLSearchParams(options.searchParams),
  } as unknown as PayloadRequest

  const response = (await endpoint.handler(req)) as Response
  const body = await response.json().catch(() => null)
  // Створені замовлення прибираються після тестів.
  if (body?.order?.id) data.trackOrder(body.order.id)

  return { status: response.status, body: stabilize(body) }
}

/** Виклик у всіх мовах: відповіді однакові, знімок знімається з однієї. */
const callAll = async (endpoint: Endpoint, options: Options = {}) => {
  const [first, ...rest] = await Promise.all(languages.map((language) => call(endpoint, language, options)))
  for (const other of rest) expect(other).toEqual(first)

  return first
}

describe('I2: публічні ендпоінти не залежать від мови адмінки', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
  })

  beforeEach(() => silenceSideEffects(payload))

  afterAll(async () => {
    await data.cleanup()
  })

  const customer = { id: NOT_ID, collection: 'users', wholesale: false }

  describe('Orders', () => {
    it.each([
      ['без позицій', { shippingAddress }],
      ['без адреси', { items: [{ product: NOT_ID, quantity: 1 }] }],
      ['некоректна позиція', { items: [{ product: NOT_ID }], shippingAddress }],
      ['невідомий товар', { items: [{ product: NOT_ID, quantity: 1 }], shippingAddress }],
    ])('createOrder: %s', async (_name, body) => {
      expect(await callAll(createOrder, { body })).toMatchSnapshot()
    })

    it('createOrder: успішне замовлення', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: String(brand.id), retailPrice: 100 })
      const body = { items: [{ product: String(product.id), quantity: 2 }], shippingAddress, paymentType: 'cash' }

      const result = await callAll(createOrder, { body })

      expect(result.status).toBe(201)
      expect(result).toMatchSnapshot()
    })

    it('getMyOrders: без користувача', async () => {
      expect(await callAll(getMyOrders)).toMatchSnapshot()
    })
  })

  describe('Carts', () => {
    it.each([
      ['addCartItem без користувача', addCartItem, { body: { item: { productId: 'x', quantity: 1 } } }],
      ['addCartItem некоректне тіло', addCartItem, { user: customer, body: { item: { productId: 'x', quantity: 0 } } }],
      ['clearCart без користувача', clearCart, {}],
      ['getCartByUser без користувача', getCartByUser, {}],
      ['getGuestCart без items', getGuestCart, { body: {} }],
      ['mergeCart без користувача', mergeCart, { body: {} }],
      ['removeCartItem без користувача', removeCartItem, { body: {} }],
      ['removeCartItem некоректне тіло', removeCartItem, { user: customer, body: {} }],
      ['updateCartItem без користувача', updateCartItem, { body: { item: {} } }],
      ['updateCartItem некоректне тіло', updateCartItem, { user: customer, body: { item: {} } }],
      ['validatePromo без коду', validatePromo, { body: {} }],
      ['validatePromo невідомий код', validatePromo, { body: { promoCode: 'NO-SUCH-PROMO', items: [] } }],
    ] as const)('%s', async (_name, endpoint, options) => {
      expect(await callAll(endpoint as Endpoint, options as Options)).toMatchSnapshot()
    })
  })

  describe('Users', () => {
    it.each([
      ['addFavoritesItem без користувача', addFavoritesItem, { body: {} }],
      ['removeFavoritesItem без користувача', removeFavoritesItem, { routeParams: { id: 'x' } }],
      ['updateUserInfo без користувача', updateUserInfo, { body: {} }],
    ] as const)('%s', async (_name, endpoint, options) => {
      expect(await callAll(endpoint as Endpoint, options as Options)).toMatchSnapshot()
    })
  })

  describe('Контент і каталог', () => {
    it.each([
      ['getBrandInfo без slug', getBrandInfo],
      ['getPageBySlug без slug', getPageBySlug],
      ['getSinglePost без slug', getSinglePost],
      ['getSingleProduct без identifier', getSingleProduct],
    ] as const)('%s', async (_name, endpoint) => {
      expect(await callAll(endpoint as Endpoint)).toMatchSnapshot()
    })

    it('getSingleProduct: невідомий товар', async () => {
      expect(await callAll(getSingleProduct, { routeParams: { identifier: NOT_ID } })).toMatchSnapshot()
    })

    it('getSingleProduct: опублікований товар', async () => {
      const brand = await data.brand()
      const product = await data.product({ brand: String(brand.id), retailPrice: 100 })

      expect(await callAll(getSingleProduct, { routeParams: { identifier: String(product.id) } })).toMatchSnapshot()
    })
  })

  describe('Службові ендпоінти складу', () => {
    it.each([
      ['без користувача', undefined],
      ['не admin', { id: NOT_ID, collection: 'users', roles: ['customer'] }],
    ])('getProductStock: %s', async (_name, user) => {
      expect(await callAll(getProductStock, { user, routeParams: { id: NOT_ID } })).toMatchSnapshot()
    })
  })
})
