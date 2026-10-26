// @vitest-environment node
// jose (підпис JWT для REST-запитів) не працює з TextEncoder середовища jsdom.
import { getPayload, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { updateUserInfo } from '@/collections/Users/endpoints/updateUserInfo'
import config from '@/payload.config'

import { formatReport, importCustomerManagers } from '../../scripts/import-customer-managers'
import { makeRequest, TestData } from './helpers/fixtures'
import { silenceSideEffects } from './helpers/orderCall'
import type { AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let manager: AuthUser
let otherManager: AuthUser

const PASSWORD = 'test-password-123'
const tag = `CMG-${Date.now()}`
let counter = 0
/** Користувачі, створені самим тестом (не через TestData), для очищення. */
const createdUsers: Array<string | number> = []

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const makeUser = async (roles: Array<'admin' | 'manager' | 'customer'>): Promise<AuthUser> => {
  const user = await data.user()
  const updated = await payload.update({ collection: 'users', id: user.id, data: { roles, _verified: true } as never })
  return { ...updated, collection: 'users' } as AuthUser
}

/** Поточне значення з БД, повз access: перевірка, що воно реально збережене. */
const managerInDb = async (id: string | number) => {
  const doc = await payload.findByID({ collection: 'users', id, depth: 0, overrideAccess: true })
  return doc.manager ? idOf(doc.manager) : null
}

const rest = async (method: string, path: string, user?: AuthUser, body?: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (user) {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: PASSWORD } })
    headers.Authorization = `Bearer ${token}`
  }
  const response = await handleEndpoints({
    config,
    request: new Request(`http://localhost/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  })
  return { status: response.status, body: (await response.json()) as any }
}

const newCustomerBody = () => ({
  email: `${tag}-${++counter}@example.test`,
  password: PASSWORD,
  name: 'New',
  surname: 'Customer',
  phone: '+37360000001',
})

describe('M2: менеджер у клієнта', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)

    admin = await makeUser(['admin'])
    manager = await makeUser(['manager'])
    otherManager = await makeUser(['manager'])
  })

  afterAll(async () => {
    for (const id of createdUsers) await payload.delete({ collection: 'users', id }).catch(() => {})
    await data.cleanup()
  })

  /** Клієнт, створений напряму; за потреби одразу з менеджером. */
  const customer = async (managerId?: string | number) => {
    const user = await makeUser(['customer'])
    if (managerId) await payload.update({ collection: 'users', id: user.id, data: { manager: managerId } as never })
    return user
  }

  describe('призначення менеджера', () => {
    it('admin призначає менеджера клієнту (Local API)', async () => {
      const target = await customer()
      await payload.update({
        collection: 'users',
        id: target.id,
        data: { manager: manager.id } as never,
        user: admin,
        overrideAccess: false,
      })
      expect(await managerInDb(target.id)).toBe(String(manager.id))
    })

    it('призначення користувача без ролі manager відхиляється (Local API)', async () => {
      const target = await customer()
      const notManager = await customer()
      await expect(
        payload.update({
          collection: 'users',
          id: target.id,
          data: { manager: notManager.id } as never,
          user: admin,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      expect(await managerInDb(target.id)).toBeNull()
    })

    it('призначення користувача без ролі manager відхиляється (REST), менеджера приймається', async () => {
      const target = await customer()
      const notManager = await customer()

      const bad = await rest('PATCH', `/users/${target.id}`, admin, { manager: notManager.id })
      expect(bad.status).toBeGreaterThanOrEqual(400)
      expect(await managerInDb(target.id)).toBeNull()

      const ok = await rest('PATCH', `/users/${target.id}`, admin, { manager: manager.id })
      expect(ok.status).toBe(200)
      expect(await managerInDb(target.id)).toBe(String(manager.id))
    })

    it('колишній менеджер без ролі не блокує збереження клієнта, якщо значення не змінилося', async () => {
      const target = await customer(manager.id)
      await payload.update({ collection: 'users', id: manager.id, data: { roles: ['customer'] } as never })
      try {
        await payload.update({
          collection: 'users',
          id: target.id,
          data: { name: 'Renamed' },
          user: admin,
          overrideAccess: false,
        })
        expect(await managerInDb(target.id)).toBe(String(manager.id))
      } finally {
        await payload.update({ collection: 'users', id: manager.id, data: { roles: ['manager'] } as never })
      }
    })
  })

  describe('manager створює клієнта (В10)', () => {
    it('manager = він сам, roles = [customer], значення реально в БД', async () => {
      const created = await payload.create({
        collection: 'users',
        data: { ...newCustomerBody(), manager: otherManager.id, roles: ['admin'] } as never,
        user: manager,
        overrideAccess: false,
        disableVerificationEmail: true,
      })
      createdUsers.push(created.id)

      const stored = await payload.findByID({ collection: 'users', id: created.id, depth: 0, overrideAccess: true })
      expect(idOf(stored.manager)).toBe(String(manager.id))
      expect(stored.roles).toEqual(['customer'])
    })

    it('admin створює клієнта з будь-яким менеджером: значення не змінюється', async () => {
      const created = await payload.create({
        collection: 'users',
        data: { ...newCustomerBody(), manager: otherManager.id } as never,
        user: admin,
        overrideAccess: false,
        disableVerificationEmail: true,
      })
      createdUsers.push(created.id)
      expect(await managerInDb(created.id)).toBe(String(otherManager.id))
    })

    it('manager не може змінити manager існуючого клієнта, admin може', async () => {
      const target = await customer(manager.id)

      await payload
        .update({
          collection: 'users',
          id: target.id,
          data: { manager: otherManager.id } as never,
          user: manager,
          overrideAccess: false,
        })
        .catch(() => {})
      expect(await managerInDb(target.id)).toBe(String(manager.id))

      await payload.update({
        collection: 'users',
        id: target.id,
        data: { manager: otherManager.id } as never,
        user: admin,
        overrideAccess: false,
      })
      expect(await managerInDb(target.id)).toBe(String(otherManager.id))
    })
  })

  describe('клієнт і гість', () => {
    it('customer не бачить manager у GET /api/users/me', async () => {
      const user = await customer(manager.id)
      const me = await rest('GET', '/users/me', user)
      expect(me.status).toBe(200)
      expect(me.body.user.email).toBe(user.email)
      expect(me.body.user).not.toHaveProperty('manager')
      expect(me.body.user).not.toHaveProperty('roles')
    })

    it('manager і admin бачать manager у REST', async () => {
      const target = await customer(manager.id)
      for (const viewer of [admin, manager]) {
        const response = await rest('GET', `/users/${target.id}?depth=0`, viewer)
        expect(response.status).toBe(200)
        expect(idOf(response.body.manager)).toBe(String(manager.id))
      }
    })

    it('updateUserInfo не віддає manager і не записує manager, roles, wholesale, brandDiscounts', async () => {
      const user = await customer(manager.id)
      const response = (await updateUserInfo.handler(
        makeRequest(payload, {
          user,
          body: { name: 'Changed', manager: otherManager.id, roles: ['admin'], wholesale: true, brandDiscounts: [] },
        }),
      )) as Response
      const body = (await response.json()) as any

      expect(response.status).toBe(200)
      expect(body.name).toBe('Changed')
      expect(body).not.toHaveProperty('manager')
      expect(body).not.toHaveProperty('roles')

      const stored = await payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
      expect(idOf(stored.manager)).toBe(String(manager.id))
      expect(stored.roles).toEqual(['customer'])
      expect(stored.wholesale).toBe(false)
    })

    it('customer не може записати manager через PATCH /api/users/:id', async () => {
      const user = await customer()
      await rest('PATCH', `/users/${user.id}`, user, { manager: manager.id, name: 'Self edit' })
      expect(await managerInDb(user.id)).toBeNull()
    })

    it('публічна реєстрація лишає manager порожнім (Local API і REST)', async () => {
      const viaLocal = await payload.create({
        collection: 'users',
        data: { ...newCustomerBody(), manager: manager.id } as never,
        overrideAccess: false,
        disableVerificationEmail: true,
      })
      createdUsers.push(viaLocal.id)
      expect(await managerInDb(viaLocal.id)).toBeNull()

      // Лист верифікації йде через адаптер напряму, тому глушимо його, а не payload.sendEmail.
      vi.spyOn(payload.email, 'sendEmail').mockResolvedValue(undefined as never)
      const viaRest = await rest('POST', '/users', undefined, { ...newCustomerBody(), manager: manager.id })
      expect(viaRest.status, JSON.stringify(viaRest.body)).toBe(201)
      createdUsers.push(viaRest.body.doc.id)
      expect(await managerInDb(viaRest.body.doc.id)).toBeNull()
    })
  })

  describe('скрипт import-customer-managers', () => {
    const run = (csv: string, options: { apply?: boolean; overwrite?: boolean } = {}) =>
      importCustomerManagers(payload, csv, options)

    it('dry-run нічого не пише, --apply пише, листів немає', async () => {
      const target = await customer()
      const csv = `customerEmail;managerEmail\n${target.email};${manager.email}\n`

      const dry = await run(csv)
      expect(dry).toMatchObject({ applied: false, planned: 1, written: 0, skipped: 0, errors: [] })
      expect(formatReport(dry)).toContain('Dry-run')
      expect(await managerInDb(target.id)).toBeNull()

      const sendEmail = vi.spyOn(payload, 'sendEmail')
      sendEmail.mockClear()
      const applied = await run(csv, { apply: true })
      expect(applied).toMatchObject({ applied: true, written: 1, skipped: 0, errors: [] })
      expect(await managerInDb(target.id)).toBe(String(manager.id))
      expect(sendEmail).not.toHaveBeenCalled()
    })

    it('помилки: порожні рядки, невідомі email, не-менеджер, admin/manager у клієнтах, дубль', async () => {
      const [target, unknownManagerRow, notManagerRow] = [await customer(), await customer(), await customer()]
      const plain = await customer()
      const csv = [
        `${target.email};`,
        `;${manager.email}`,
        `nobody-${tag}@example.test;${manager.email}`,
        `${unknownManagerRow.email};nobody-${tag}@example.test`,
        `${notManagerRow.email};${plain.email}`,
        `${admin.email};${manager.email}`,
        `${otherManager.email};${manager.email}`,
        `${target.email};${manager.email}`,
        `${target.email};${manager.email}`,
      ].join('\n')

      const report = await run(csv, { apply: true })
      const messages = report.errors.map((error) => `${error.line}: ${error.message}`).join('\n')

      expect(report.errors.map((error) => error.line), messages).toEqual([1, 2, 3, 4, 5, 6, 7, 9])
      expect(messages).toMatch(/1: Both/)
      expect(messages).toMatch(/2: Both/)
      expect(messages).toMatch(/3: Unknown customer/)
      expect(messages).toMatch(/4: Unknown manager/)
      expect(messages).toMatch(/5: .*does not have the manager role/)
      expect(messages).toMatch(/6: .*admin or manager role/)
      expect(messages).toMatch(/7: .*admin or manager role/)
      expect(messages).toMatch(/9: Duplicate customer/)
      // Рядок 8 коректний і записаний попри помилки в інших.
      expect(report.written).toBe(1)
      expect(await managerInDb(target.id)).toBe(String(manager.id))
    })

    it('клієнт з іншим менеджером пропускається без --overwrite, з ним перезаписується', async () => {
      const target = await customer(manager.id)
      const csv = `${target.email};${otherManager.email}`

      const skipped = await run(csv, { apply: true })
      expect(skipped.skipped).toBe(1)
      expect(skipped.written).toBe(0)
      expect(skipped.errors[0].message).toMatch(/another manager/)
      expect(await managerInDb(target.id)).toBe(String(manager.id))

      const overwritten = await run(csv, { apply: true, overwrite: true })
      expect(overwritten).toMatchObject({ written: 1, skipped: 0, errors: [] })
      expect(await managerInDb(target.id)).toBe(String(otherManager.id))
    })
  })
})
