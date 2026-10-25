import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { activeSuppliersOnly } from '@/collections/Suppliers'
import type { User } from '@/payload-types'

let payload: Payload
const created: Array<number | string> = []
const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as unknown as User

const tag = `SUP-${Date.now()}`
const supplier = async (data: { name: string; isActive?: boolean }) => {
  const doc = await payload.create({ collection: 'suppliers', data })
  created.push(doc.id)
  return doc
}

describe('A4: постачальники', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'suppliers', where: { id: { in: created } } })
  })

  it('isActive за замовчуванням true, isCarrier false', async () => {
    const doc = await supplier({ name: `${tag} Default` })

    expect(doc.isActive).toBe(true)
    expect(doc.isCarrier).toBe(false)
  })

  it('пошук за назвою', async () => {
    await supplier({ name: `${tag} Alpha Cosmetics` })
    await supplier({ name: `${tag} Beta Logistics` })

    const { docs } = await payload.find({
      collection: 'suppliers',
      where: { name: { like: `${tag} Alpha` } },
    })

    expect(docs.map((doc) => doc.name)).toEqual([`${tag} Alpha Cosmetics`])
    expect(payload.collections.suppliers.config.admin.listSearchableFields).toContain('name')
  })

  it('filterOptions залишає лише активних', async () => {
    const active = await supplier({ name: `${tag} Active` })
    const inactive = await supplier({ name: `${tag} Inactive`, isActive: false })

    expect(activeSuppliersOnly).toEqual({ isActive: { equals: true } })

    const { docs } = await payload.find({
      collection: 'suppliers',
      where: { and: [activeSuppliersOnly, { name: { like: tag } }] },
      pagination: false,
    })
    const ids = docs.map((doc) => doc.id)
    expect(ids).toContain(active.id)
    expect(ids).not.toContain(inactive.id)
  })

  it('доступ лише для admin', async () => {
    const read = (user: User | null) =>
      payload.find({ collection: 'suppliers', overrideAccess: false, user })

    await expect(read(asUser(['admin']))).resolves.toBeDefined()
    await expect(read(asUser(['customer']))).rejects.toThrow()
    await expect(read(null)).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'suppliers',
        data: { name: `${tag} Forbidden` },
        overrideAccess: false,
        user: asUser(['customer']),
      }),
    ).rejects.toThrow()
  })
})
