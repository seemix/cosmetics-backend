import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { down, up } from '@/migrations/20261025_100000_seed_warehouses'
import type { User } from '@/payload-types'

let payload: Payload
const args = () => ({ payload, req: {} as never, session: undefined })

const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as unknown as User

describe('A3: склади й налаштування обліку', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    // Лишаємо тестову БД засіяною, як після міграції: defaultWebWarehouse = main.
    await up(args())
    const main = (await payload.find({ collection: 'warehouses', where: { code: { equals: 'main' } } })).docs[0]
    await payload.updateGlobal({ slug: 'accounting-settings', data: { defaultWebWarehouse: main.id } })
  })

  it('міграція засіває main і shop та ставить defaultWebWarehouse = main (повтор безпечний)', async () => {
    await down(args())
    await up(args())
    await up(args())

    const { docs } = await payload.find({ collection: 'warehouses', sort: 'sortOrder', pagination: false })
    expect(docs.map((doc) => doc.code)).toEqual(['main', 'shop'])
    expect(docs.every((doc) => doc.isActive)).toBe(true)

    const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 1 })
    expect(typeof settings.defaultWebWarehouse === 'object' && settings.defaultWebWarehouse?.code).toBe('main')
  })

  it('міграція не перезаписує вже обраний склад', async () => {
    const shop = (await payload.find({ collection: 'warehouses', where: { code: { equals: 'shop' } } })).docs[0]
    await payload.updateGlobal({ slug: 'accounting-settings', data: { defaultWebWarehouse: shop.id } })

    await up(args())

    const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 1 })
    expect(typeof settings.defaultWebWarehouse === 'object' && settings.defaultWebWarehouse?.code).toBe('shop')
  })

  it('stockControlEnabled за замовчуванням вимкнено', async () => {
    const settings = await payload.findGlobal({ slug: 'accounting-settings' })

    expect(settings.stockControlEnabled).toBe(false)
  })

  it('код складу унікальний', async () => {
    await expect(
      payload.create({ collection: 'warehouses', data: { name: 'Дубль', code: 'main' } }),
    ).rejects.toThrow()
  })

  it('доступ лише для admin: склади', async () => {
    const read = (user: User | null) =>
      payload.find({ collection: 'warehouses', overrideAccess: false, user })

    await expect(read(asUser(['admin']))).resolves.toBeDefined()
    await expect(read(asUser(['customer']))).rejects.toThrow()
    await expect(read(null)).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'warehouses',
        data: { name: 'X', code: 'x-test' },
        overrideAccess: false,
        user: asUser(['customer']),
      }),
    ).rejects.toThrow()
  })

  it('доступ лише для admin: налаштування', async () => {
    const read = (user: User | null) =>
      payload.findGlobal({ slug: 'accounting-settings', overrideAccess: false, user })

    await expect(read(asUser(['admin']))).resolves.toBeDefined()
    await expect(read(asUser(['customer']))).rejects.toThrow()
    await expect(read(null)).rejects.toThrow()
    await expect(
      payload.updateGlobal({
        slug: 'accounting-settings',
        data: { stockControlEnabled: true },
        overrideAccess: false,
        user: asUser(['customer']),
      }),
    ).rejects.toThrow()
  })
})
