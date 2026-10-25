import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { applyCashMoves } from '@/collections/Finance/cashLedger'
import config from '@/payload.config'
import { down, up } from '@/migrations/20261026_100000_seed_cash_accounts'
import type { User } from '@/payload-types'

import { TestData } from './helpers/fixtures'
import { type AuthUser, createAdmin, deleteDocumentsDirectly, inTransaction } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser

const tag = `CSHT-${Date.now()}`
const accounts: string[] = []
const openings: Array<number | string> = []
const fixtureDoc = { collection: 'test-docs', id: 'fixture' }

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as unknown as User

const newAccount = async (suffix: string, extra: { allowNegative?: boolean; isActive?: boolean } = {}) => {
  const doc = await payload.create({
    collection: 'cash-accounts',
    data: { name: `${tag} ${suffix}`, code: `${tag}-${suffix}`, kind: 'cash', ...extra },
  })
  accounts.push(String(doc.id))
  return String(doc.id)
}

const balanceOf = async (id: string) =>
  (await payload.findByID({ collection: 'cash-accounts', id, depth: 0 })).balanceBani

const movesOf = async (collection: string, id: number | string) =>
  (
    await payload.find({
      collection: 'cash-moves',
      where: { docCollection: { equals: collection }, docId: { equals: String(id) } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

const draftOpening = async (lines: Array<{ account: string; amountBani: number }>) => {
  const doc = await payload.create({
    collection: 'opening-balances',
    data: { status: 'draft', kind: 'cash', documentDate: '2026-10-24T00:00:00.000Z', cashLines: lines },
    ...asAdmin,
  })
  openings.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'opening-balances', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'opening-balances',
    id,
    data: { status: 'reversed', reversalReason: 'wrong count' },
    ...asAdmin,
  })

const spend = (account: string, amountBani: number) =>
  inTransaction(payload, (req) => applyCashMoves(req, { doc: fixtureDoc, lines: [{ account, deltaBani: -amountBani }] }))

describe('C1: каси, статті витрат, початкові залишки кас', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'opening-balances', openings)
    await payload.delete({ collection: 'cash-moves', where: { account: { in: accounts } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { in: accounts } } })
    await data.cleanup()
    // Лишаємо тестову БД засіяною, як після міграції.
    await up({ payload, req: {} as never, session: undefined })
  })

  describe('довідники', () => {
    it('міграція засіває cash, bank і статті витрат; повтор безпечний', async () => {
      const args = { payload, req: {} as never, session: undefined }
      await down(args)
      await up(args)
      await up(args)

      const { docs } = await payload.find({ collection: 'cash-accounts', sort: 'code', pagination: false })
      const seeded = docs.filter((doc) => ['bank', 'cash'].includes(doc.code))
      expect(seeded.map((doc) => [doc.code, doc.kind, doc.balanceBani, doc.allowNegative, doc.isActive])).toEqual([
        ['bank', 'bank', 0, false, true],
        ['cash', 'cash', 0, false, true],
      ])

      const salary = await payload.find({ collection: 'expense-categories', where: { code: { equals: 'salary' } } })
      expect(salary.docs).toHaveLength(1)
      expect(salary.docs[0].isSalary).toBe(true)
      expect((await payload.count({ collection: 'expense-categories', where: { code: { in: ['rent', 'other'] } } })).totalDocs).toBe(2)
    })

    it('код каси й статті унікальний', async () => {
      await expect(
        payload.create({ collection: 'cash-accounts', data: { name: 'Duplicate', code: 'cash', kind: 'cash' } }),
      ).rejects.toThrow()
      await expect(
        payload.create({ collection: 'expense-categories', data: { name: 'Duplicate', code: 'rent' } }),
      ).rejects.toThrow()
    })

    it('balanceBani лише для читання: ні створення, ні зміна через API не діють', async () => {
      const created = await payload.create({
        collection: 'cash-accounts',
        data: { name: `${tag} RO`, code: `${tag}-ro`, kind: 'cash', balanceBani: 99900 },
        ...asAdmin,
      })
      accounts.push(String(created.id))
      expect(created.balanceBani).toBe(0)

      const updated = await payload.update({
        collection: 'cash-accounts',
        id: created.id,
        data: { name: `${tag} RO renamed`, balanceBani: 5 },
        ...asAdmin,
      })
      expect(updated.name).toBe(`${tag} RO renamed`)
      expect(await balanceOf(String(created.id))).toBe(0)
    })

    it('доступ лише для admin: каси, статті, журнал', async () => {
      for (const collection of ['cash-accounts', 'expense-categories', 'cash-moves'] as const) {
        const read = (user: User | null) => payload.find({ collection, overrideAccess: false, user })

        await expect(read(asUser(['admin']))).resolves.toBeDefined()
        await expect(read(asUser(['customer']))).rejects.toThrow()
        await expect(read(null)).rejects.toThrow()
      }
    })

    it('cash-moves не змінюється через API навіть admin', async () => {
      const account = await newAccount('journal')

      await expect(
        payload.create({
          collection: 'cash-moves',
          data: { date: new Date().toISOString(), account, deltaBani: 100, docCollection: 'x', docId: 'x' },
          ...asAdmin,
        }),
      ).rejects.toThrow()
    })
  })

  describe('opening-balances kind=cash', () => {
    it('проведення збільшує баланс кас і пише cash-moves; чернетка баланс не змінює', async () => {
      const [a, b] = [await newAccount('a'), await newAccount('b')]
      const draft = await draftOpening([
        { account: a, amountBani: 125050 },
        { account: b, amountBani: 700 },
      ])

      expect(draft.status).toBe('draft')
      expect(await balanceOf(a)).toBe(0)
      expect(await movesOf('opening-balances', draft.id)).toHaveLength(0)

      const posted = await post(draft.id)

      expect(posted.status).toBe('posted')
      expect(await balanceOf(a)).toBe(125050)
      expect(await balanceOf(b)).toBe(700)

      const moves = await movesOf('opening-balances', draft.id)
      expect(moves).toHaveLength(2)
      expect(moves.every((move) => move.docNumber === posted.number && !move.reversalOf)).toBe(true)
      expect(moves.map((move) => [String(move.account), move.deltaBani]).sort()).toEqual(
        [
          [a, 125050],
          [b, 700],
        ].sort(),
      )
    })

    it('сторно дзеркальне: баланс повертається, рухи з reversalOf і нульовою сумою', async () => {
      const a = await newAccount('rev')
      const draft = await draftOpening([{ account: a, amountBani: 5000 }])
      await post(draft.id)

      const reversed = await reverse(draft.id)

      expect(reversed.status).toBe('reversed')
      expect(await balanceOf(a)).toBe(0)

      const moves = await movesOf('opening-balances', draft.id)
      const [original, mirror] = moves
      expect(moves).toHaveLength(2)
      expect(mirror.deltaBani).toBe(-original.deltaBani)
      expect(mirror.reversalOf).toBe(original.id)
      expect(moves.reduce((sum, move) => sum + move.deltaBani, 0)).toBe(0)
    })

    it('сторно відхиляється, якщо з каси вже витрачено; баланс і журнал не змінюються', async () => {
      const a = await newAccount('spent')
      const draft = await draftOpening([{ account: a, amountBani: 1000 }])
      await post(draft.id)
      await spend(a, 400)

      await expect(reverse(draft.id)).rejects.toThrow(/Insufficient funds/)

      expect(await balanceOf(a)).toBe(600)
      expect((await movesOf('opening-balances', draft.id)).length).toBe(1)
      expect((await payload.findByID({ collection: 'opening-balances', id: draft.id })).status).toBe('posted')
    })

    it('каса з allowNegative = true може піти в мінус при сторно', async () => {
      const a = await newAccount('neg', { allowNegative: true })
      const draft = await draftOpening([{ account: a, amountBani: 1000 }])
      await post(draft.id)
      await spend(a, 1500)

      await reverse(draft.id)

      expect(await balanceOf(a)).toBe(-1500)
    })

    it('одну касу не можна вказати двічі; порожній документ не проводиться', async () => {
      const a = await newAccount('dup')

      await expect(
        payload.create({
          collection: 'opening-balances',
          data: {
            status: 'draft',
            kind: 'cash',
            documentDate: '2026-10-24T00:00:00.000Z',
            cashLines: [
              { account: a, amountBani: 100 },
              { account: a, amountBani: 200 },
            ],
          },
          ...asAdmin,
        }),
      ).rejects.toThrow(/only once/)

      await expect(
        payload.create({
          collection: 'opening-balances',
          data: { status: 'draft', kind: 'cash', documentDate: '2026-10-24T00:00:00.000Z', cashLines: [] },
          ...asAdmin,
        }),
      ).rejects.toThrow()
    })

    it('сума має бути додатною цілою кількістю бані', async () => {
      const a = await newAccount('amount')

      for (const amountBani of [0, -100, 10.5]) {
        await expect(
          payload.create({
            collection: 'opening-balances',
            data: {
              status: 'draft',
              kind: 'cash',
              documentDate: '2026-10-24T00:00:00.000Z',
              cashLines: [{ account: a, amountBani }],
            },
            ...asAdmin,
          }),
        ).rejects.toThrow()
      }
    })

    it('проведений документ не змінюється й не видаляється', async () => {
      const a = await newAccount('frozen')
      const draft = await draftOpening([{ account: a, amountBani: 100 }])
      await post(draft.id)

      await expect(
        payload.update({ collection: 'opening-balances', id: draft.id, data: { comment: 'x' }, ...asAdmin }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'opening-balances', id: draft.id, ...asAdmin })).rejects.toThrow()
    })
  })

  describe('умовне списання', () => {
    it('баланс не йде в мінус при allowNegative = false', async () => {
      const a = await newAccount('floor')
      const draft = await draftOpening([{ account: a, amountBani: 1000 }])
      await post(draft.id)

      await expect(spend(a, 1001)).rejects.toThrow(/Insufficient funds/)
      expect(await balanceOf(a)).toBe(1000)

      await spend(a, 1000)
      expect(await balanceOf(a)).toBe(0)
    })

    it('паралельні списання не перевищують баланс', async () => {
      const a = await newAccount('race')
      const draft = await draftOpening([{ account: a, amountBani: 1000 }])
      await post(draft.id)

      const results = await Promise.allSettled([spend(a, 600), spend(a, 600)])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await balanceOf(a)).toBe(400)
      expect((await movesOf(fixtureDoc.collection, fixtureDoc.id)).filter((move) => String(move.account) === a)).toHaveLength(1)
    })
  })
})
