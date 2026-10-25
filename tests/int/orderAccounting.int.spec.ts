import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'
import { createAdmin, type AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let productId: string
let webWarehouse: string
let adminWarehouse: string
let previousSettings: { defaultWebWarehouse: unknown; defaultAdminWarehouse: unknown }

const tag = `OACC-${Date.now()}`
const warehouses: string[] = []
const orders: string[] = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const createByAdmin = async (extra: Record<string, unknown> = {}) => {
  const order = await payload.create({
    collection: 'orders',
    user: admin,
    data: { items: [{ product: productId, quantity: 3, price: 0 }], total: 0, ...extra } as never,
    depth: 0,
  })
  orders.push(String(order.id))
  return order
}

describe('S2.2/S2.6: облікові поля замовлення', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    admin = await createAdmin(payload, data)
    productId = String((await data.product({ brand: String((await data.brand()).id), retailPrice: 125 })).id)

    for (const code of ['web', 'admin']) {
      const doc = await payload.create({
        collection: 'warehouses',
        data: { name: `${tag} ${code}`, code: `${tag}-${code}` },
      })
      warehouses.push(String(doc.id))
    }
    ;[webWarehouse, adminWarehouse] = warehouses

    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousSettings = {
      defaultWebWarehouse: before.defaultWebWarehouse,
      defaultAdminWarehouse: before.defaultAdminWarehouse,
    }
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { defaultWebWarehouse: webWarehouse, defaultAdminWarehouse: adminWarehouse } as never,
    })
  })

  afterAll(async () => {
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: {
        defaultWebWarehouse: previousSettings.defaultWebWarehouse ? idOf(previousSettings.defaultWebWarehouse) : null,
        defaultAdminWarehouse: previousSettings.defaultAdminWarehouse
          ? idOf(previousSettings.defaultAdminWarehouse)
          : null,
      } as never,
    }).catch(() => {})
    for (const id of orders) await payload.delete({ collection: 'orders', id }).catch(() => {})
    for (const id of warehouses) await payload.delete({ collection: 'warehouses', id }).catch(() => {})
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('замовлення сайту: source=web, склад з налаштувань, виручка в банях', async () => {
    const response = await callCreateOrder(payload, {
      body: {
        items: [{ product: productId, quantity: 2 }],
        shippingAddress,
        warehouse: adminWarehouse,
      },
    })
    expect(response.status).toBe(201)
    expect(Object.keys(response.body.order).sort()).toEqual(['id', 'items', 'orderNumber'])

    const order = await loadOrder(payload, data, response.body.order.id)
    expect(order.source).toBe('web')
    expect(idOf(order.warehouse)).toBe(webWarehouse)
    expect(order.createdBy ?? null).toBeNull()
    expect(order.accounting?.revenueBani).toBe(order.total * 100)
    expect(order.accounting?.revenueBani).toBe(25000)
    expect(order.paidBani).toBe(0)
    expect(order.paymentState).toBe('unpaid')
  })

  it('замовлення з адмінки без адреси й клієнта: source=admin, автор, склад за замовчуванням', async () => {
    const order = await createByAdmin()

    expect(order.source).toBe('admin')
    expect(idOf(order.createdBy)).toBe(String(admin.id))
    expect(idOf(order.warehouse)).toBe(adminWarehouse)
    expect(order.total).toBe(375)
    expect(order.accounting?.revenueBani).toBe(37500)
  })

  it('з адмінки можна вибрати склад «Магазин» при створенні', async () => {
    const order = await createByAdmin({ warehouse: webWarehouse })
    expect(idOf(order.warehouse)).toBe(webWarehouse)
  })

  it('склад, джерело й автор не змінюються після створення', async () => {
    const order = await createByAdmin()
    const updated = await payload.update({
      collection: 'orders',
      id: order.id,
      user: admin,
      data: { warehouse: webWarehouse, source: 'web', createdBy: null, status: 'shipped' } as never,
      depth: 0,
    })

    expect(updated.status).toBe('shipped')
    expect(updated.source).toBe('admin')
    expect(idOf(updated.warehouse)).toBe(adminWarehouse)
    expect(idOf(updated.createdBy)).toBe(String(admin.id))
  })

  it('замовлення сайту без полів адреси відхиляється, з адмінки дозволено', async () => {
    await expect(
      payload.create({
        collection: 'orders',
        data: { items: [{ product: productId, quantity: 1, price: 0 }], total: 0, shippingAddress: {} } as never,
        context: { orderSource: 'web' },
      }),
    ).rejects.toThrow(/fields are invalid|поля|câmpuri/i)

    const order = await createByAdmin({ shippingAddress: {} })
    expect(order.shippingAddress?.city ?? null).toBeNull()
  })

  it('createOrder без адреси, як і раніше, 400', async () => {
    const { status } = await callCreateOrder(payload, {
      body: { items: [{ product: productId, quantity: 1 }] },
    })
    expect(status).toBe(400)
  })

  it('клієнт не бачить accounting, source, склад, автора; бачить paidBani і paymentState', async () => {
    const customer = await data.user()
    const order = await createByAdmin({ customer: customer.id })

    const asCustomer = await payload.findByID({
      collection: 'orders',
      id: order.id,
      user: { ...customer, collection: 'users' },
      overrideAccess: false,
      depth: 0,
    })

    expect(asCustomer.id).toBe(order.id)
    expect(asCustomer).not.toHaveProperty('accounting')
    expect(asCustomer).not.toHaveProperty('source')
    expect(asCustomer).not.toHaveProperty('warehouse')
    expect(asCustomer).not.toHaveProperty('createdBy')
    expect(asCustomer.paidBani).toBe(0)
    expect(asCustomer.paymentState).toBe('unpaid')

    const asAdmin = await payload.findByID({
      collection: 'orders',
      id: order.id,
      user: admin,
      overrideAccess: false,
      depth: 0,
    })
    expect(asAdmin.accounting?.revenueBani).toBe(37500)
  })
})
