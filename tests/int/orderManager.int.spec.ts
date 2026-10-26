import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getMyOrders } from '@/collections/Orders/endpoints/getMyOrders'
import config from '@/payload.config'

import { makeRequest, TestData } from './helpers/fixtures'
import { callCreateOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'
import { cleanupStock, deleteDocumentsDirectly, qtyAt, stockUp, type AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let managerOne: AuthUser
let managerTwo: AuthUser
let productId: string
let warehouseId: string
let previousSettings: Record<string, unknown>

const tag = `OMGR-${Date.now()}`
const warehouses: string[] = []
const products: string[] = []
const orders: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const makeUser = async (roles: Array<'admin' | 'manager' | 'customer'>): Promise<AuthUser> => {
  const user = await data.user()
  const updated = await payload.update({ collection: 'users', id: user.id, data: { roles, _verified: true } as never })
  return { ...updated, collection: 'users' } as AuthUser
}

const customerOf = async (managerId?: string | number): Promise<AuthUser> => {
  const user = await makeUser(['customer'])
  if (!managerId) return user
  const updated = await payload.update({ collection: 'users', id: user.id, data: { manager: managerId } as never })
  return { ...updated, collection: 'users' } as AuthUser
}

const setFlag = (assignOrderToCreatorIfNoManager: boolean) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: { assignOrderToCreatorIfNoManager } as never })

/** Замовлення в адмінці від імені `user` з реальною перевіркою access. */
const createInAdmin = async (user: AuthUser, customer?: string | number) => {
  const order = await payload.create({
    collection: 'orders',
    user,
    overrideAccess: false,
    data: { items: [{ product: productId, quantity: 1, price: 0 }], total: 0, customer, warehouse: warehouseId } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  return order
}

/** Значення з БД повз access: перевірка, що знімок реально збережений. */
const storedManager = async (id: string | number) => {
  const doc = await payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true })
  return doc.manager ? idOf(doc.manager) : null
}

describe('M3: знімок менеджера в замовленні (розд. 7.1)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)

    admin = await makeUser(['admin'])
    managerOne = await makeUser(['manager'])
    managerTwo = await makeUser(['manager'])
    productId = String((await data.product({ brand: String((await data.brand()).id), retailPrice: 100 })).id)
    products.push(productId)

    const warehouse = await payload.create({ collection: 'warehouses', data: { name: `${tag} wh`, code: tag } })
    warehouseId = String(warehouse.id)
    warehouses.push(warehouseId)
    await stockUp(payload, productId, warehouseId, 100, 100000)

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      assignOrderToCreatorIfNoManager: before.assignOrderToCreatorIfNoManager ?? false,
      defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
      defaultAdminWarehouse: before.defaultAdminWarehouse ? idOf(before.defaultAdminWarehouse) : null,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: {
        stockControlEnabled: true,
        assignOrderToCreatorIfNoManager: false,
        defaultWebWarehouse: warehouseId,
        defaultAdminWarehouse: warehouseId,
      } as never,
    })
  })

  afterAll(async () => {
    await payload.updateGlobal({ slug: 'accounting-settings', data: previousSettings as never }).catch(() => {})
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await cleanupStock(payload, products, warehouses)
    await data.cleanup()
    vi.restoreAllMocks()
  })

  describe('createOrder (сайт)', () => {
    it('гість: manager = null, відповідь без нових полів', async () => {
      const response = await callCreateOrder(payload, {
        body: { items: [{ product: productId, quantity: 1 }], shippingAddress },
      })
      expect(response.status).toBe(201)
      expect(Object.keys(response.body.order).sort()).toEqual(['id', 'items', 'orderNumber'])
      expect(JSON.stringify(response.body)).not.toContain('manager')

      orders.push(String(response.body.order.id))
      expect(await storedManager(response.body.order.id)).toBeNull()
    })

    it('клієнт з менеджером M1: manager = M1, відповіді createOrder і getMyOrders без manager', async () => {
      const customer = await customerOf(managerOne.id)
      const response = await callCreateOrder(payload, {
        user: customer,
        body: { items: [{ product: productId, quantity: 1 }], shippingAddress },
      })
      expect(response.status).toBe(201)
      expect(Object.keys(response.body.order).sort()).toEqual(['id', 'items', 'orderNumber'])
      expect(JSON.stringify(response.body)).not.toContain('manager')

      orders.push(String(response.body.order.id))
      expect(await storedManager(response.body.order.id)).toBe(String(managerOne.id))

      const mine = (await getMyOrders.handler({ ...makeRequest(payload, { user: customer }), query: {} } as never)) as Response
      const body = (await mine.json()) as { docs: Array<Record<string, unknown>> }
      expect(body.docs).toHaveLength(1)
      // discount і promoCodeApplied порожні й у JSON не потрапляють.
      expect(Object.keys(body.docs[0]).sort()).toEqual([
        'createdAt',
        'id',
        'items',
        'orderNumber',
        'status',
        'total',
      ])
      expect(JSON.stringify(body)).not.toContain(String(managerOne.id))
    })

    it('клієнт без менеджера, прапорець увімкнено: manager = null (творця немає)', async () => {
      await setFlag(true)
      try {
        const response = await callCreateOrder(payload, {
          user: await customerOf(),
          body: { items: [{ product: productId, quantity: 1 }], shippingAddress },
        })
        orders.push(String(response.body.order.id))
        expect(await storedManager(response.body.order.id)).toBeNull()
      } finally {
        await setFlag(false)
      }
    })
  })

  describe('замовлення в адмінці', () => {
    it('M2 створює клієнту менеджера M1: manager = M1, createdBy = M2, значення в БД', async () => {
      const customer = await customerOf(managerOne.id)
      const order = await createInAdmin(managerTwo, customer.id)

      expect(idOf(order.createdBy)).toBe(String(managerTwo.id))
      expect(await storedManager(order.id)).toBe(String(managerOne.id))

      const stored = await payload.findByID({ collection: 'orders', id: order.id, depth: 0, overrideAccess: true })
      expect(idOf(stored.createdBy)).toBe(String(managerTwo.id))
    })

    it('M2 створює клієнту без менеджера: прапорець увімкнено ⇒ M2, вимкнено ⇒ null', async () => {
      const customer = await customerOf()

      await setFlag(true)
      try {
        const on = await createInAdmin(managerTwo, customer.id)
        expect(await storedManager(on.id)).toBe(String(managerTwo.id))
      } finally {
        await setFlag(false)
      }

      const off = await createInAdmin(managerTwo, customer.id)
      expect(await storedManager(off.id)).toBeNull()
    })

    it('M2 створює без клієнта (магазин): прапорець увімкнено ⇒ M2, вимкнено ⇒ null', async () => {
      await setFlag(true)
      try {
        const on = await createInAdmin(managerTwo)
        expect(await storedManager(on.id)).toBe(String(managerTwo.id))
      } finally {
        await setFlag(false)
      }

      const off = await createInAdmin(managerTwo)
      expect(await storedManager(off.id)).toBeNull()
    })

    it('admin: клієнту з менеджером ⇒ цей менеджер, клієнту без менеджера ⇒ null (навіть з прапорцем)', async () => {
      const withManager = await createInAdmin(admin, (await customerOf(managerOne.id)).id)
      expect(await storedManager(withManager.id)).toBe(String(managerOne.id))

      await setFlag(true)
      try {
        const without = await createInAdmin(admin, (await customerOf()).id)
        expect(await storedManager(without.id)).toBeNull()
      } finally {
        await setFlag(false)
      }
    })

    it('після зміни менеджера клієнта старі замовлення не змінюються, нові отримують нового', async () => {
      const customer = await customerOf(managerOne.id)
      const before = await createInAdmin(admin, customer.id)

      await payload.update({ collection: 'users', id: customer.id, data: { manager: managerTwo.id } as never })

      const after = await createInAdmin(admin, customer.id)
      expect(await storedManager(before.id)).toBe(String(managerOne.id))
      expect(await storedManager(after.id)).toBe(String(managerTwo.id))
    })

    it('update замовлення (навіть admin) не змінює manager', async () => {
      const order = await createInAdmin(admin, (await customerOf(managerOne.id)).id)

      // REST/адмінка: field access мовчки прибирає значення з запиту.
      await payload.update({
        collection: 'orders',
        id: order.id,
        user: admin,
        overrideAccess: false,
        data: { manager: managerTwo.id } as never,
        depth: 0,
      })
      expect(await storedManager(order.id)).toBe(String(managerOne.id))

      // Код з overrideAccess: зміну відхиляє guardPostedOrder.
      await expect(
        payload.update({ collection: 'orders', id: order.id, data: { manager: managerTwo.id } as never, depth: 0 }),
      ).rejects.toThrow()
      expect(await storedManager(order.id)).toBe(String(managerOne.id))

      // Адмінка надсилає документ цілком із тим самим manager: це не зміна.
      const updated = await payload.update({
        collection: 'orders',
        id: order.id,
        user: admin,
        overrideAccess: false,
        data: { manager: managerOne.id, status: 'shipped' } as never,
        depth: 0,
      })
      expect(updated.status).toBe('shipped')
      expect(await storedManager(order.id)).toBe(String(managerOne.id))
    })

    it('замовлення, створені до M3, лишаються з manager = null', async () => {
      const order = await createInAdmin(admin)
      await payload.update({ collection: 'orders', id: order.id, data: { status: 'shipped' } as never, depth: 0 })
      expect(await storedManager(order.id)).toBeNull()
    })
  })

  describe('видимість manager', () => {
    it('admin і manager бачать, customer і гість ні', async () => {
      const customer = await customerOf(managerOne.id)
      const order = await createInAdmin(admin, customer.id)

      const read = (user?: AuthUser) =>
        payload.findByID({ collection: 'orders', id: order.id, depth: 0, user, overrideAccess: false })

      expect(idOf((await read(admin)).manager)).toBe(String(managerOne.id))
      expect(idOf((await read(managerTwo)).manager)).toBe(String(managerOne.id))
      expect(await read(customer)).not.toHaveProperty('manager')
      await expect(read()).rejects.toThrow()
    })
  })

  describe('списання залишку', () => {
    it('замовлення менеджера списує залишок, поле manager не заважає', async () => {
      const before = await qtyAt(payload, productId, warehouseId)
      const order = await createInAdmin(managerTwo, (await customerOf(managerOne.id)).id)

      const stored = await payload.findByID({ collection: 'orders', id: order.id, depth: 0, overrideAccess: true })
      expect(stored.accounting?.stockPostedAt).toBeTruthy()
      expect(await qtyAt(payload, productId, warehouseId)).toBe(before - 1)
    })
  })
})
