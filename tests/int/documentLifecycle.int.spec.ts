import { createLocalReq, getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import type { User } from '@/payload-types'
import { COUNTERS_COLLECTION } from '@/services/counters'
import {
  documentLifecycle,
  type DocumentTransitionArgs,
  MAX_TRANSACTION_ATTEMPTS,
  runInTransaction,
} from '@/services/documents/documentLifecycle'
import { ConcurrentUpdateError } from '@/services/stock/errors'
import { receive } from '@/services/stock/stockLedger.service'

import { TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let productId: string
let warehouseId: string
let lockedUntilBefore: string | null | undefined

const prefix = `T${Date.now()}`
type AuthUser = User & { collection: 'users' }
const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as AuthUser
const admin = asUser(['admin'])
const customer = asUser(['customer'])

const onPost = vi.fn<(args: DocumentTransitionArgs) => void>()
const onReverse = vi.fn<(args: DocumentTransitionArgs) => void>()
const lifecycle = documentLifecycle({ prefix, counterKey: prefix, onPost, onReverse })
const [beforeChange] = lifecycle.hooks.beforeChange
const [beforeDelete] = lifecycle.hooks.beforeDelete

const reqAs = (user: AuthUser | null) => createLocalReq({ user: user ?? undefined }, payload)

type Doc = Record<string, unknown>

/** Виклик хука так, як його викликає операція update/create Payload. */
const change = async (
  user: AuthUser | null,
  incoming: Doc,
  originalDoc?: Doc,
): Promise<Doc> =>
  beforeChange({
    collection: { slug: 'test-docs' },
    context: {},
    data: { ...incoming },
    operation: originalDoc ? 'update' : 'create',
    originalDoc,
    req: await reqAs(user),
  } as never) as Promise<Doc>

const draft = async (): Promise<Doc> => ({
  id: 'doc-1',
  ...(await change(admin, { documentDate: '2026-10-01T00:00:00.000Z', comment: 'first' })),
})

const post = async (doc: Doc) => ({ ...doc, ...(await change(admin, { ...doc, status: 'posted' }, doc)) })

const setLockedUntil = (lockedUntil: string | null) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil } })

describe('A7: життєвий цикл документа', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    lockedUntilBefore = (await payload.findGlobal({ slug: 'accounting-settings' })).lockedUntil

    productId = String((await data.product({ brand: String((await data.brand()).id), retailPrice: 100 })).id)
    warehouseId = String(
      (await payload.create({ collection: 'warehouses', data: { name: `${prefix} wh`, code: `${prefix}-wh` } })).id,
    )
  })

  beforeEach(() => {
    onPost.mockReset()
    onReverse.mockReset()
  })

  afterAll(async () => {
    await setLockedUntil(lockedUntilBefore ?? null)
    const byProduct = { product: { equals: productId } }
    await payload.delete({ collection: 'stock-moves', where: byProduct })
    await payload.delete({ collection: 'stock-balances', where: byProduct })
    await payload.delete({ collection: 'product-costs', where: byProduct })
    await payload.delete({ collection: 'warehouses', id: warehouseId })
    await payload.db.connection.collection<{ _id: string }>(COUNTERS_COLLECTION).deleteOne({ _id: prefix })
    await data.cleanup()
  })

  describe('поля шапки', () => {
    it('є всі поля з розд. 2.2', () => {
      const names = lifecycle.fields.map((field) => ('name' in field ? field.name : undefined))

      expect(names).toEqual([
        'number',
        'status',
        'documentDate',
        'postedAt',
        'postedBy',
        'reversedAt',
        'reversedBy',
        'reversalReason',
        'comment',
      ])
    })

    it('назва поля дати налаштовується', () => {
      const { fields } = documentLifecycle({ prefix, counterKey: prefix, dateField: { name: 'operationDate', label: 'Operation date' } })

      expect(fields.some((field) => 'name' in field && field.name === 'operationDate')).toBe(true)
    })
  })

  describe('створення', () => {
    it('чернетка з номером із лічильника, системні поля порожні', async () => {
      const first = await change(admin, { documentDate: '2026-10-01', postedAt: '2026-01-01', postedBy: 'x' })
      const second = await change(admin, { documentDate: '2026-10-01' })

      expect(first).toMatchObject({ status: 'draft', postedAt: null, postedBy: null })
      expect(first.number).toMatch(new RegExp(`^${prefix}-\\d{6}$`))
      expect(Number(String(second.number).split('-')[1])).toBe(Number(String(first.number).split('-')[1]) + 1)
    })

    it('одразу проведеним документ не створюється', async () => {
      await expect(change(admin, { documentDate: '2026-10-01', status: 'posted' })).rejects.toThrow(/draft/)
    })
  })

  describe('draft → posted', () => {
    it('admin проводить: postedAt, postedBy і onPost з id та датою', async () => {
      const doc = await draft()
      const before = Date.now()
      const posted = await post(doc)

      expect(posted.status).toBe('posted')
      expect(posted.postedBy).toBe(admin.id)
      expect(new Date(String(posted.postedAt)).getTime()).toBeGreaterThanOrEqual(before)
      expect(onPost).toHaveBeenCalledTimes(1)
      expect(onPost.mock.calls[0][0]).toMatchObject({ id: 'doc-1' })
      expect(onPost.mock.calls[0][0].date.toISOString()).toBe(posted.postedAt)
    })

    it('чернетка редагується вільно, без проведення', async () => {
      const doc = await draft()
      const edited = await change(admin, { ...doc, comment: 'changed' }, doc)

      expect(edited).toMatchObject({ status: 'draft', comment: 'changed' })
      expect(onPost).not.toHaveBeenCalled()
    })

    it('системні поля в чернетці не змінюються вручну', async () => {
      const doc = await draft()
      const edited = await change(admin, { ...doc, number: 'HACK', postedAt: '2026-01-01' }, doc)

      expect(edited).toMatchObject({ number: doc.number, postedAt: null })
    })

    it.each([
      ['customer', customer],
      ['без користувача', null],
    ])('%s не може провести', async (_, user) => {
      const doc = await draft()

      await expect(change(user, { ...doc, status: 'posted' }, doc)).rejects.toMatchObject({ status: 403 })
      expect(onPost).not.toHaveBeenCalled()
    })

    it('чернетку не можна одразу сторнувати', async () => {
      const doc = await draft()

      await expect(change(admin, { ...doc, status: 'reversed', reversalReason: 'x' }, doc)).rejects.toThrow(/posted/)
    })
  })

  describe('posted', () => {
    it('будь-яка зміна в проведеному документі заборонена', async () => {
      const posted = await post(await draft())

      await expect(change(admin, { ...posted, comment: 'changed' }, posted)).rejects.toThrow(/comment/)
      await expect(change(admin, { documentDate: '2026-01-01' }, posted)).rejects.toThrow(/documentDate/)
    })

    it('повернення в чернетку заборонене', async () => {
      const posted = await post(await draft())

      await expect(change(admin, { ...posted, status: 'draft' }, posted)).rejects.toThrow(/reversed/)
    })

    it('повторне збереження без змін дозволене й не проводить вдруге', async () => {
      const posted = await post(await draft())
      onPost.mockReset()

      await expect(change(admin, { ...posted }, posted)).resolves.toMatchObject({ status: 'posted' })
      expect(onPost).not.toHaveBeenCalled()
    })
  })

  describe('posted → reversed', () => {
    it('reversalReason обов’язкова', async () => {
      const posted = await post(await draft())

      await expect(change(admin, { ...posted, status: 'reversed' }, posted)).rejects.toThrow(/reason/i)
      await expect(change(admin, { ...posted, status: 'reversed', reversalReason: '   ' }, posted)).rejects.toThrow(
        /reason/i,
      )
      expect(onReverse).not.toHaveBeenCalled()
    })

    it('admin сторнує: reversedAt, reversedBy і onReverse', async () => {
      const posted = await post(await draft())
      const reversed = await change(admin, { ...posted, status: 'reversed', reversalReason: ' wrong supplier ' }, posted)

      expect(reversed).toMatchObject({ status: 'reversed', reversalReason: 'wrong supplier', reversedBy: admin.id })
      expect(reversed.postedAt).toBe(posted.postedAt)
      expect(onReverse).toHaveBeenCalledTimes(1)
      expect(onReverse.mock.calls[0][0].date.toISOString()).toBe(reversed.reversedAt)
    })

    it('разом зі сторно інші поля не змінюються', async () => {
      const posted = await post(await draft())

      await expect(
        change(admin, { ...posted, status: 'reversed', reversalReason: 'x', comment: 'changed' }, posted),
      ).rejects.toThrow(/comment/)
    })

    it('customer не може сторнувати', async () => {
      const posted = await post(await draft())

      await expect(
        change(customer, { ...posted, status: 'reversed', reversalReason: 'x' }, posted),
      ).rejects.toMatchObject({ status: 403 })
    })

    it('reversed кінцевий: жодних змін', async () => {
      const posted = await post(await draft())
      const reversed = { ...posted, ...(await change(admin, { ...posted, status: 'reversed', reversalReason: 'x' }, posted)) }

      for (const status of ['draft', 'posted', 'reversed']) {
        await expect(change(admin, { ...reversed, status }, reversed)).rejects.toThrow(/final/)
      }
    })
  })

  describe('закритий період', () => {
    it('дата обліку ≤ lockedUntil блокує проведення й сторно', async () => {
      const posted = await post(await draft())
      const doc = await draft()
      onPost.mockReset()

      await setLockedUntil(new Date(Date.now() + 60_000).toISOString())
      try {
        await expect(change(admin, { ...doc, status: 'posted' }, doc)).rejects.toThrow(/locked/)
        await expect(
          change(admin, { ...posted, status: 'reversed', reversalReason: 'x' }, posted),
        ).rejects.toThrow(/locked/)
        expect(onPost).not.toHaveBeenCalled()
        expect(onReverse).not.toHaveBeenCalled()
      } finally {
        await setLockedUntil(new Date(Date.now() - 60_000).toISOString())
      }

      // Період до минулої дати не заважає проводити зараз.
      await expect(change(admin, { ...doc, status: 'posted' }, doc)).resolves.toMatchObject({ status: 'posted' })
    })
  })

  describe('видалення', () => {
    const remove = async (status: string | undefined) => {
      const req = await reqAs(admin)
      const findByID = vi.fn().mockResolvedValue(status ? { id: 'doc-1', status } : null)
      req.payload = { ...payload, findByID } as unknown as Payload

      await beforeDelete({ collection: { slug: 'test-docs' }, context: {}, id: 'doc-1', req } as never)
      expect(findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'test-docs', id: 'doc-1', req }))
    }

    it('чернетку видалити можна', async () => {
      await expect(remove('draft')).resolves.toBeUndefined()
    })

    it.each(['posted', 'reversed'])('%s видалити не можна', async (status) => {
      await expect(remove(status)).rejects.toThrow(/draft/)
    })
  })

  describe('runInTransaction', () => {
    const stockQty = async () =>
      (
        await payload.find({
          collection: 'stock-balances',
          where: { product: { equals: productId }, warehouse: { equals: warehouseId } },
          depth: 0,
        })
      ).docs[0]?.qty ?? 0

    const receiveOne = (req: PayloadRequest) =>
      receive(req, {
        doc: { collection: 'test-docs', id: prefix },
        moveType: 'opening',
        lines: [{ product: productId, warehouse: warehouseId, qty: 1, valueBani: 100 }],
      })

    it('повторює транзієнтну помилку, записи невдалих спроб відкочено', async () => {
      const start = await stockQty()
      const req = await reqAs(admin)
      let calls = 0

      await runInTransaction(req, async () => {
        calls++
        await receiveOne(req)
        if (calls < MAX_TRANSACTION_ATTEMPTS) throw new ConcurrentUpdateError()
      })

      expect(calls).toBe(MAX_TRANSACTION_ATTEMPTS)
      expect(await stockQty()).toBe(start + 1)
      expect(await req.transactionID).toBeUndefined()
    })

    it('після 3 транзієнтних збоїв кидає помилку й нічого не лишає', async () => {
      const start = await stockQty()
      const req = await reqAs(admin)
      let calls = 0

      await expect(
        runInTransaction(req, async () => {
          calls++
          await receiveOne(req)
          throw Object.assign(new Error('write conflict'), { code: 112 })
        }),
      ).rejects.toThrow('write conflict')

      expect(calls).toBe(3)
      expect(await stockQty()).toBe(start)
    })

    it('нетранзієнтна помилка не повторюється', async () => {
      const req = await reqAs(admin)
      const fn = vi.fn().mockRejectedValue(new Error('validation'))

      await expect(runInTransaction(req, fn)).rejects.toThrow('validation')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('у вже відкритій транзакції виконує fn один раз без повторів', async () => {
      const req = await reqAs(admin)
      const fn = vi.fn().mockRejectedValue(new ConcurrentUpdateError())

      await expect(runInTransaction(req, () => runInTransaction(req, fn))).rejects.toBeInstanceOf(ConcurrentUpdateError)
      // Зовнішній виклик повторив транзакцію тричі, внутрішній щоразу виконувався один раз.
      expect(fn).toHaveBeenCalledTimes(MAX_TRANSACTION_ATTEMPTS)
    })
  })
})
