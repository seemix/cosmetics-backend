// @vitest-environment node
// jose (підпис JWT для REST-запитів) не працює з TextEncoder середовища jsdom.
import { getPayload, handleEndpoints, type CollectionSlug, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getProductStock } from '@/endpoints/getProductStock'
import config from '@/payload.config'

import { makeRequest, TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import { cleanupStock, deleteDocumentsDirectly, qtyAt, stockUp, type AuthUser } from './helpers/stock'

type Role = 'admin' | 'manager' | 'customer' | 'guest'
const ROLES: Role[] = ['admin', 'manager', 'customer', 'guest']

let payload: Payload
let data: TestData
const users = {} as Record<Exclude<Role, 'guest'>, AuthUser>
let otherCustomer: AuthUser
let otherManager: AuthUser
let wholesaleCustomer: AuthUser
let brand: string
let shop: string
let publishedProduct: string
let draftProduct: string
let previousSettings: Record<string, unknown>

const PASSWORD = 'test-password-123'
const tag = `ACM-${Date.now()}`
const products: string[] = []
const warehouses: string[] = []
const orders: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)
const userOf = (role: Role) => (role === 'guest' ? undefined : users[role])

/** Результат виклику Local API: `ok` або `denied` (Forbidden / 403 / відхилено хуком). */
const outcome = async (call: () => Promise<unknown>): Promise<'ok' | 'denied'> => {
  try {
    await call()
    return 'ok'
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 401 || status === 403 || (error as Error).name === 'Forbidden') return 'denied'
    throw error
  }
}

const expectMatrix = async (
  call: (role: Role) => Promise<unknown>,
  expected: Record<Role, 'ok' | 'denied'>,
) => {
  const actual = {} as Record<Role, 'ok' | 'denied'>
  for (const role of ROLES) actual[role] = await outcome(() => call(role))
  expect(actual).toEqual(expected)
}

const ADMIN_ONLY = { admin: 'ok', manager: 'denied', customer: 'denied', guest: 'denied' } as const
const ADMIN_MANAGER = { admin: 'ok', manager: 'ok', customer: 'denied', guest: 'denied' } as const

const makeUser = async (roles: Array<'admin' | 'manager' | 'customer'>, wholesale = false): Promise<AuthUser> => {
  const user = await data.user({ wholesale })
  const updated = await payload.update({
    collection: 'users',
    id: user.id,
    data: { roles, _verified: true } as never,
  })
  return { ...updated, collection: 'users' } as AuthUser
}

const newProduct = async (retailPrice = 100, wholesalePrice = 80) => {
  const id = String((await data.product({ brand, retailPrice, wholesalePrice })).id)
  products.push(id)
  return id
}

/** Замовлення від admin у «Магазині» (зі списанням), для перевірок читання й переходів. */
const adminOrder = async (customer?: string, status = 'pending') => {
  const order = await payload.create({
    collection: 'orders',
    user: users.admin,
    data: { items: [{ product: publishedProduct, quantity: 1, price: 0 }], total: 0, customer, warehouse: shop } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  if (status === 'pending') return order
  return payload.update({ collection: 'orders', id: order.id, data: { status } as never, depth: 0 })
}

const managerUpdate = (id: string | number, changes: Record<string, unknown>) =>
  payload.update({ collection: 'orders', id, data: changes as never, user: users.manager, overrideAccess: false, depth: 0 })

const rest = async (path: string, user?: AuthUser) => {
  const headers: Record<string, string> = {}
  if (user) {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: PASSWORD } })
    headers.Authorization = `Bearer ${token}`
  }
  const response = await handleEndpoints({ config, request: new Request(`http://localhost/api${path}`, { headers }) })
  return { status: response.status, body: (await response.json()) as any }
}

describe('M1: матриця прав (розд. 11)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)

    users.admin = await makeUser(['admin'])
    users.manager = await makeUser(['manager'])
    users.customer = await makeUser(['customer'])
    otherCustomer = await makeUser(['customer'])
    otherManager = await makeUser(['manager'])
    wholesaleCustomer = await makeUser(['customer'], true)
    brand = String((await data.brand()).id)

    const warehouse = await payload.create({ collection: 'warehouses', data: { name: `${tag} Магазин`, code: tag } })
    shop = String(warehouse.id)
    warehouses.push(shop)

    publishedProduct = await newProduct()
    const draft = await payload.create({
      collection: 'products',
      data: { title: `${tag} draft`, slug: `${tag}-draft`, subtitle: 'Чернетка', article: `${tag}-D`, brand, retailPrice: 50, _status: 'draft' } as never,
      draft: true,
    })
    draftProduct = String(draft.id)
    products.push(draftProduct)
    await stockUp(payload, publishedProduct, shop, 100, 100000)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
    }
    await payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: true } as never })
  })

  afterAll(async () => {
    await payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: previousSettings.stockControlEnabled } as never })
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
  })

  describe('адмін-панель', () => {
    it('Users.access.admin: admin і manager так, customer ні', async () => {
      const access = (await payload.config.collections.find((c) => c.slug === 'users'))!.access.admin!
      const can = (role: Role) => access({ req: { user: userOf(role) } } as never)
      expect([await can('admin'), await can('manager'), await can('customer'), await can('guest')]).toEqual([
        true,
        true,
        false,
        false,
      ])
    })

    it('залишки (В11): stock-balances у сайдбарі й панель на картці товару для admin і manager', () => {
      const collection = (slug: string) => payload.config.collections.find((c) => c.slug === slug)!
      const hidden = collection('stock-balances').admin.hidden as (args: { user: unknown }) => boolean
      const stockPanel = collection('products').fields.find((f) => 'name' in f && f.name === 'stockPanel')!
      const shown = stockPanel.admin!.condition! as (data: unknown, sibling: unknown, ctx: { user: unknown }) => boolean

      expect(ROLES.map((role) => !hidden({ user: userOf(role) ?? null }))).toEqual([true, true, false, false])
      expect(ROLES.map((role) => shown({}, {}, { user: userOf(role) ?? null }))).toEqual([true, true, false, false])
      expect((collection('product-costs').admin.hidden as typeof hidden)({ user: users.manager })).toBe(true)
    })
  })

  describe('products', () => {
    it('read: admin і manager бачать чернетки, customer і гість лише опубліковані', async () => {
      const visible = {} as Record<Role, boolean>
      for (const role of ROLES) {
        const found = await payload.find({
          collection: 'products',
          where: { id: { in: [draftProduct, publishedProduct] } },
          user: userOf(role),
          overrideAccess: false,
          draft: true,
        })
        expect(found.docs.map((doc) => String(doc.id))).toContain(publishedProduct)
        visible[role] = found.docs.some((doc) => String(doc.id) === draftProduct)
      }
      expect(visible).toEqual({ admin: true, manager: true, customer: false, guest: false })
    })

    it('create і delete лише admin', async () => {
      await expectMatrix(async (role) => {
        const doc = await payload.create({
          collection: 'products',
          data: { title: `${tag} ${role}`, slug: `${tag}-${role}`, subtitle: 'x', article: `${tag}-${role}`, brand, retailPrice: 1 } as never,
          user: userOf(role),
          overrideAccess: false,
          draft: true,
        })
        products.push(String(doc.id))
      }, ADMIN_ONLY)

      const target = await newProduct()
      await expectMatrix(async (role) => {
        if (role === 'admin') return // admin видаляє останнім, щоб інші ролі перевірялись на наявному товарі
        await payload.delete({ collection: 'products', id: target, user: userOf(role), overrideAccess: false })
      }, { admin: 'ok', manager: 'denied', customer: 'denied', guest: 'denied' })
      await payload.delete({ collection: 'products', id: target, user: users.admin, overrideAccess: false })
    })

    it('update: admin і manager (описові поля), customer і гість ні', async () => {
      await expectMatrix(
        (role) =>
          payload.update({
            collection: 'products',
            id: publishedProduct,
            data: { subtitle: `by ${role}` },
            user: userOf(role),
            overrideAccess: false,
            draft: true,
          }),
        ADMIN_MANAGER,
      )
    })

    it('manager не змінює retailPrice і wholesalePrice, admin змінює', async () => {
      const id = await newProduct(100, 80)
      await payload.update({
        collection: 'products',
        id,
        data: { retailPrice: 1, wholesalePrice: 1, subtitle: 'manager' },
        user: users.manager,
        overrideAccess: false,
        draft: true,
      })
      const latest = await payload.findByID({ collection: 'products', id, draft: true })
      expect(latest.subtitle).toBe('manager')
      expect([latest.retailPrice, latest.wholesalePrice]).toEqual([100, 80])

      await payload.update({ collection: 'products', id, data: { retailPrice: 120, wholesalePrice: 90 }, user: users.admin, overrideAccess: false })
      const saved = await payload.findByID({ collection: 'products', id })
      expect([saved.retailPrice, saved.wholesalePrice]).toEqual([120, 90])
    })

    it('manager не публікує товар, лише зберігає чернетку', async () => {
      const id = await newProduct()
      const publish = payload.update({
        collection: 'products',
        id,
        data: { subtitle: 'publish', _status: 'published' } as never,
        user: users.manager,
        overrideAccess: false,
      })
      await expect(publish).rejects.toMatchObject({ status: 403 })

      // Збереження без `draft` теж публікує, тому відхиляється.
      const save = payload.update({ collection: 'products', id, data: { subtitle: 'save' }, user: users.manager, overrideAccess: false })
      await expect(save).rejects.toMatchObject({ status: 403 })
      expect((await payload.findByID({ collection: 'products', id })).subtitle).not.toBe('save')
    })

    it('wholesalePrice read: admin, manager, оптовик; роздрібний клієнт і гість ні', async () => {
      const seen = {} as Record<string, boolean>
      const readers = { ...users, wholesale: wholesaleCustomer, guest: undefined }
      for (const [role, user] of Object.entries(readers)) {
        const doc = await payload.findByID({ collection: 'products', id: publishedProduct, user, overrideAccess: false })
        seen[role] = doc.wholesalePrice !== undefined
      }
      expect(seen).toEqual({ admin: true, manager: true, customer: false, wholesale: true, guest: false })
    })
  })

  describe('облікові колекції', () => {
    const adminOnlyCollections: CollectionSlug[] = [
      'product-costs',
      'stock-moves',
      'purchases',
      'stock-transfers',
      'stock-adjustments',
      'opening-balances',
      'suppliers',
      'cash-moves',
      'customer-balances',
      'customer-moves',
    ]

    it.each(adminOnlyCollections)('%s: read лише admin', async (collection) => {
      await expectMatrix((role) => payload.find({ collection, limit: 1, user: userOf(role), overrideAccess: false }), ADMIN_ONLY)
    })

    it.each(['cash-accounts', 'expense-categories', 'cash-operations'] as CollectionSlug[])(
      '%s: read admin і manager (В19, вміст звужує access)',
      async (collection) => {
        await expectMatrix((role) => payload.find({ collection, limit: 1, user: userOf(role), overrideAccess: false }), ADMIN_MANAGER)
      },
    )

    it('accounting-settings: read і update лише admin', async () => {
      await expectMatrix(
        (role) => payload.findGlobal({ slug: 'accounting-settings', user: userOf(role), overrideAccess: false }),
        ADMIN_ONLY,
      )
      await expectMatrix(async (role) => {
        if (role === 'admin') return
        await payload.updateGlobal({ slug: 'accounting-settings', data: {}, user: userOf(role), overrideAccess: false })
      }, ADMIN_ONLY)
    })

    it('warehouses: read admin і manager (вибір складу в замовленні), запис лише admin', async () => {
      await expectMatrix((role) => payload.find({ collection: 'warehouses', limit: 1, user: userOf(role), overrideAccess: false }), ADMIN_MANAGER)
      await expectMatrix(async (role) => {
        const doc = await payload.create({
          collection: 'warehouses',
          data: { name: `${tag} ${role}`, code: `${tag}-${role}` },
          user: userOf(role),
          overrideAccess: false,
        })
        warehouses.push(String(doc.id))
      }, ADMIN_ONLY)
    })

    it('stock-balances: read admin і manager (лише кількість), запис нікому', async () => {
      await expectMatrix(
        (role) => payload.find({ collection: 'stock-balances', limit: 1, user: userOf(role), overrideAccess: false }),
        ADMIN_MANAGER,
      )
      const asManager = await payload.find({
        collection: 'stock-balances',
        where: { product: { equals: publishedProduct } },
        user: users.manager,
        overrideAccess: false,
        depth: 0,
      })
      expect(asManager.docs[0].qty).toBeGreaterThan(0)
      expect(Object.keys(asManager.docs[0]).filter((key) => /bani|cost|value/i.test(key))).toEqual([])
      await expect(
        payload.create({
          collection: 'stock-balances',
          data: { product: publishedProduct, warehouse: shop, qty: 1 },
          user: users.manager,
          overrideAccess: false,
        }),
      ).rejects.toMatchObject({ status: 403 })
    })

    it('ендпоінт A14: admin з вартістю, manager лише кількість, customer 403, гість 401', async () => {
      const call = async (user?: AuthUser) => {
        const response = (await getProductStock.handler({
          ...makeRequest(payload, { user }),
          routeParams: { id: publishedProduct },
        } as never)) as Response
        return { status: response.status, body: (await response.json()) as any }
      }

      const asAdmin = await call(users.admin)
      expect(asAdmin.status).toBe(200)
      expect(asAdmin.body.valueBani).toBeGreaterThan(0)

      const asManager = await call(users.manager)
      expect(asManager.status).toBe(200)
      expect(asManager.body.totalQty).toBe(asAdmin.body.totalQty)
      expect(asManager.body.warehouses).toEqual(asAdmin.body.warehouses)
      expect(Object.keys(asManager.body).sort()).toEqual(['productId', 'totalQty', 'warehouses'])

      expect((await call(users.customer)).status).toBe(403)
      expect((await call(undefined)).status).toBe(401)
    })
  })

  describe('orders', () => {
    it('create: admin і manager; customer і гість лише через createOrder', async () => {
      await expectMatrix(async (role) => {
        const order = await payload.create({
          collection: 'orders',
          data: { items: [{ product: publishedProduct, quantity: 1, price: 0 }], total: 0, warehouse: shop } as never,
          user: userOf(role),
          overrideAccess: false,
          depth: 0,
        })
        orders.push(String(order.id))
      }, ADMIN_MANAGER)
    })

    it('read: admin і manager усі, customer свої, гість нічого; accounting лише admin', async () => {
      const own = await adminOrder(String(users.customer.id))
      const foreign = await adminOrder(String(otherCustomer.id))

      for (const role of ['admin', 'manager'] as const) {
        const doc = await payload.findByID({ collection: 'orders', id: foreign.id, user: users[role], overrideAccess: false, depth: 0 })
        expect(String(doc.id)).toBe(String(foreign.id))
        expect(doc.paidBani).toBe(0)
        expect(doc.paymentState).toBe('unpaid')
        expect(doc.warehouse).toBeDefined()
        if (role === 'admin') expect(doc.accounting?.stockPostedAt).toBeTruthy()
        else expect(doc).not.toHaveProperty('accounting')
      }

      const asCustomer = await payload.find({
        collection: 'orders',
        where: { id: { in: [own.id, foreign.id] } },
        user: users.customer,
        overrideAccess: false,
        depth: 0,
      })
      expect(asCustomer.docs.map((doc) => String(doc.id))).toEqual([String(own.id)])
      expect(asCustomer.docs[0]).not.toHaveProperty('accounting')
      expect(asCustomer.docs[0].paymentState).toBe('unpaid')

      await expect(
        payload.find({ collection: 'orders', limit: 1, user: undefined, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })
    })

    it('update статусу: admin і manager (pending → shipped), customer і гість ні', async () => {
      await expectMatrix(async (role) => {
        const order = await adminOrder()
        await payload.update({ collection: 'orders', id: order.id, data: { status: 'shipped' }, user: userOf(role), overrideAccess: false })
      }, ADMIN_MANAGER)
    })

    it('delete: лише admin і лише непроведене', async () => {
      const posted = await adminOrder()
      await expectMatrix(async (role) => {
        if (role === 'admin') return
        await payload.delete({ collection: 'orders', id: posted.id, user: userOf(role), overrideAccess: false })
      }, ADMIN_ONLY)
      await expect(
        payload.delete({ collection: 'orders', id: posted.id, user: users.admin, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('manager: pending → shipped проходить і з повним документом, як надсилає адмінка', async () => {
      const order = await adminOrder(String(users.customer.id))
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...form } = await payload.findByID({
        collection: 'orders',
        id: order.id,
        user: users.manager,
        overrideAccess: false,
        depth: 0,
      })

      const updated = await managerUpdate(order.id, { ...form, status: 'shipped' })
      expect(updated.status).toBe('shipped')
      expect(updated.total).toBe(order.total)
    })

    it.each([
      ['pending → cancelled', 'pending', { status: 'cancelled' }],
      ['pending → paid', 'pending', { status: 'paid' }],
      ['shipped → pending', 'shipped', { status: 'pending' }],
      ['shipped → cancelled', 'shipped', { status: 'cancelled' }],
      ['зміна total', 'pending', { total: 1 }],
      ['зміна items', 'pending', { items: [{ product: publishedProduct, quantity: 5, price: 100 }] }],
      ['зміна customer', 'pending', { customer: 'CUSTOMER' }],
      ['зміна коментаря разом зі статусом', 'pending', { status: 'shipped', comment: 'інше' }],
    ])('manager: %s відхиляється', async (_name, status, changes) => {
      const order = await adminOrder(String(users.customer.id), status)
      const patch = { ...changes } as Record<string, unknown>
      if (patch.customer === 'CUSTOMER') patch.customer = String(otherCustomer.id)

      await expect(managerUpdate(order.id, patch)).rejects.toMatchObject({ status: 403 })
      const after = await payload.findByID({ collection: 'orders', id: order.id, depth: 0 })
      expect(after.status).toBe(status)
      expect(after.total).toBe(order.total)
    })

    it('manager створює замовлення в «Магазині» без адреси: списання, accounting бачить лише admin', async () => {
      const before = await qtyAt(payload, publishedProduct, shop)
      const order = await payload.create({
        collection: 'orders',
        data: { items: [{ product: publishedProduct, quantity: 2, price: 1 }], total: 0, warehouse: shop } as never,
        user: users.manager,
        overrideAccess: false,
        depth: 0,
      })
      orders.push(String(order.id))

      expect(await qtyAt(payload, publishedProduct, shop)).toBe(before - 2)
      expect(order).not.toHaveProperty('accounting')
      expect(order.source).toBe('admin')
      expect(idOf(order.createdBy)).toBe(String(users.manager.id))
      expect(idOf(order.warehouse)).toBe(shop)
      // Ціну задає каталог, а не менеджер (items.price для нього лише читання).
      expect(order.items?.[0]?.price).toBe(100)
      expect(order.total).toBe(200)

      const asAdmin = await payload.findByID({ collection: 'orders', id: order.id, user: users.admin, overrideAccess: false, depth: 0 })
      expect(asAdmin.accounting?.stockPostedAt).toBeTruthy()
      expect(asAdmin.accounting?.cogsBani).toBe(2000)
    })
  })

  describe('users', () => {
    it('read: admin усі; manager себе й клієнтів без roles; customer себе; гість нікого', async () => {
      const ids = [users.admin, users.manager, users.customer, otherCustomer, otherManager].map((user) => String(user.id))
      const seen = async (user?: AuthUser) =>
        (
          await payload.find({ collection: 'users', where: { id: { in: ids } }, user, overrideAccess: false, depth: 0 })
        ).docs

      expect((await seen(users.admin)).map((doc) => String(doc.id)).sort()).toEqual([...ids].sort())

      const asManager = await seen(users.manager)
      expect(asManager.map((doc) => String(doc.id)).sort()).toEqual(
        [users.manager, users.customer, otherCustomer].map((user) => String(user.id)).sort(),
      )
      for (const doc of asManager) expect(doc).not.toHaveProperty('roles')

      expect((await seen(users.customer)).map((doc) => String(doc.id))).toEqual([String(users.customer.id)])
      await expect(seen(undefined)).rejects.toMatchObject({ status: 403 })
    })

    it('manager створює клієнта лише з roles = [customer], без wholesale і brandDiscounts', async () => {
      const created = await payload.create({
        collection: 'users',
        data: {
          email: `${tag}-client@example.test`,
          password: PASSWORD,
          name: 'Client',
          surname: 'Manager',
          phone: '+37360000001',
          roles: ['admin'],
          wholesale: true,
          brandDiscounts: [{ brand, discountPercent: 10 }],
        },
        user: users.manager,
        overrideAccess: false,
        disableVerificationEmail: true,
      })
      const saved = await payload.findByID({ collection: 'users', id: created.id, depth: 0 })
      await payload.delete({ collection: 'users', id: created.id })

      expect(saved.roles).toEqual(['customer'])
      expect(saved.wholesale).toBe(false)
      expect(saved.brandDiscounts ?? []).toEqual([])
    })

    it('update і delete чужих користувачів: лише admin; customer змінює себе як раніше', async () => {
      await expectMatrix(
        (role) =>
          payload.update({ collection: 'users', id: otherCustomer.id, data: { city: role }, user: userOf(role), overrideAccess: false }),
        ADMIN_ONLY,
      )
      const self = await payload.update({
        collection: 'users',
        id: users.customer.id,
        data: { city: 'Balti' },
        user: users.customer,
        overrideAccess: false,
      })
      expect(self.city).toBe('Balti')
      await expect(
        payload.delete({ collection: 'users', id: otherCustomer.id, user: users.manager, overrideAccess: false }),
      ).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('REST (HTTP)', () => {
    it('orders: manager бачить чуже замовлення без accounting, customer не бачить чуже', async () => {
      const foreign = await adminOrder(String(otherCustomer.id))

      const asManager = await rest(`/orders/${foreign.id}?depth=0`, users.manager)
      expect(asManager.status).toBe(200)
      expect(asManager.body).not.toHaveProperty('accounting')
      expect(asManager.body.paymentState).toBe('unpaid')

      const asCustomer = await rest(`/orders/${foreign.id}?depth=0`, users.customer)
      expect(asCustomer.status).toBe(404)
    })

    it('products: manager бачить чернетку й оптову ціну, customer ні', async () => {
      const asManager = await rest(`/products?where[id][in]=${draftProduct},${publishedProduct}&draft=true&depth=0`, users.manager)
      expect(asManager.status).toBe(200)
      expect(asManager.body.docs.map((doc: { id: string }) => doc.id).sort()).toEqual([draftProduct, publishedProduct].sort())
      const published = asManager.body.docs.find((doc: { id: string }) => doc.id === publishedProduct)
      expect(published.wholesalePrice).toBe(80)

      const asCustomer = await rest(`/products?where[id][in]=${draftProduct},${publishedProduct}&depth=0`, users.customer)
      expect(asCustomer.status).toBe(200)
      expect(asCustomer.body.docs.map((doc: { id: string }) => doc.id)).toEqual([publishedProduct])
      expect(asCustomer.body.docs[0]).not.toHaveProperty('wholesalePrice')
    })
  })
})
