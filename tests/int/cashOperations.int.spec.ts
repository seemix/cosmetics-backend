import { createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { acceptPayment } from '@/collections/Orders/endpoints/acceptPayment'
import config from '@/payload.config'
import type { CashOperation, User } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { InsufficientCashError } from '@/services/finance/errors'

import { TestData } from './helpers/fixtures'
import { insertOrder } from './helpers/salary'
import { type AuthUser, createAdmin, deleteDocumentsDirectly, inTransaction } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let manager: User
let supplier: string
let rent: string
let salary: string
let lockedUntilBefore: string | null | undefined

const tag = `CSHO-${Date.now()}`
const accounts: string[] = []
const categories: string[] = []
const operations: Array<number | string> = []
const orders: string[] = []
const fundingDoc = { collection: 'test-docs', id: 'cash-operations-funding' }

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const asUser = (roles: User['roles']) => ({ id: 'test-user', roles, collection: 'users' }) as unknown as User

const newAccount = async (suffix: string, extra: { allowNegative?: boolean } = {}) => {
  const doc = await payload.create({
    collection: 'cash-accounts',
    data: { name: `${tag} ${suffix}`, code: `${tag}-${suffix}`, kind: 'cash', ...extra },
  })
  accounts.push(String(doc.id))
  return String(doc.id)
}

const newCategory = async (code: string, isSalary = false) => {
  const doc = await payload.create({
    collection: 'expense-categories',
    data: { name: `${tag} ${code}`, code: `${tag}-${code}`, isSalary },
  })
  categories.push(String(doc.id))
  return String(doc.id)
}

/** Поповнення каси напряму через сервіс, без документів. */
const fund = (account: string, amountBani: number) =>
  inTransaction(payload, (req) => applyCashMoves(req, { doc: fundingDoc, lines: [{ account, deltaBani: amountBani }] }))

const balanceOf = async (id: string) =>
  (await payload.findByID({ collection: 'cash-accounts', id, depth: 0 })).balanceBani

const movesOf = async (id: number | string) =>
  (
    await payload.find({
      collection: 'cash-moves',
      where: { docCollection: { equals: 'cash-operations' }, docId: { equals: String(id) } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

type DraftData = Partial<Omit<CashOperation, 'id' | 'createdAt' | 'updatedAt'>> &
  Pick<CashOperation, 'type' | 'account' | 'amountBani'>

const draft = async (fields: DraftData) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', ...fields },
    ...asAdmin,
  })
  operations.push(doc.id)
  return doc
}

const post = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...asAdmin })

const reverse = (id: number | string) =>
  payload.update({
    collection: 'cash-operations',
    id,
    data: { status: 'reversed', reversalReason: 'entered by mistake' },
    ...asAdmin,
  })

const setLockedUntil = (lockedUntil: string | null) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil } })

const statusOf = async (id: number | string) => (await payload.findByID({ collection: 'cash-operations', id })).status

describe('C2: касові операції', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    manager = await payload.update({ collection: 'users', id: (await data.user()).id, data: { roles: ['manager'] } })
    lockedUntilBefore = (await payload.findGlobal({ slug: 'accounting-settings' })).lockedUntil
    supplier = String((await payload.create({ collection: 'suppliers', data: { name: `${tag} supplier` } })).id)
    rent = await newCategory('rent')
    salary = await newCategory('salary', true)
  })

  afterAll(async () => {
    await setLockedUntil(lockedUntilBefore ?? null)
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await payload.delete({ collection: 'cash-moves', where: { account: { in: accounts } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { in: accounts } } })
    await payload.delete({ collection: 'expense-categories', where: { id: { in: categories } } })
    await payload.delete({ collection: 'suppliers', where: { id: { equals: supplier } } })
    await data.cleanup()
  })

  describe('expense', () => {
    it('чернетка має номер CSH і не змінює баланс; проведення зменшує касу й пише рух', async () => {
      const account = await newAccount('expense')
      await fund(account, 10000)

      const doc = await draft({ type: 'expense', account, amountBani: 2550, category: rent })

      expect(doc.number).toMatch(/^CSH-\d{6}$/)
      expect(await balanceOf(account)).toBe(10000)
      expect(await movesOf(doc.id)).toHaveLength(0)

      const posted = await post(doc.id)

      expect(posted.status).toBe('posted')
      expect(await balanceOf(account)).toBe(7450)
      const moves = await movesOf(doc.id)
      expect(moves.map((move) => [String(move.account), move.deltaBani, move.docNumber])).toEqual([
        [account, -2550, doc.number],
      ])
    })

    it('сторно повертає суму в касу дзеркальним рухом', async () => {
      const account = await newAccount('expense-rev')
      await fund(account, 5000)
      const doc = await draft({ type: 'expense', account, amountBani: 1200, category: rent })
      await post(doc.id)

      const reversed = await reverse(doc.id)

      expect(reversed.status).toBe('reversed')
      expect(await balanceOf(account)).toBe(5000)
      const [original, mirror] = await movesOf(doc.id)
      expect(mirror.deltaBani).toBe(1200)
      expect(mirror.reversalOf).toBe(original.id)
    })

    it('стаття обов\'язкова', async () => {
      const account = await newAccount('expense-nocat')

      await expect(draft({ type: 'expense', account, amountBani: 100 })).rejects.toThrow(/expense category/)
    })

    it('стаття isSalary вимагає manager; з manager проводиться', async () => {
      const account = await newAccount('salary')
      await fund(account, 400000)

      await expect(draft({ type: 'expense', account, amountBani: 400000, category: salary })).rejects.toThrow(
        /requires a manager/,
      )

      const doc = await draft({ type: 'expense', account, amountBani: 400000, category: salary, manager: manager.id })
      await post(doc.id)

      expect(await balanceOf(account)).toBe(0)
    })

    it('manager має бути користувачем з роллю manager', async () => {
      const account = await newAccount('salary-role')

      await expect(
        draft({ type: 'expense', account, amountBani: 100, category: salary, manager: admin.id }),
      ).rejects.toThrow(/manager/i)
    })

    it('поля інших типів очищаються', async () => {
      const [account, other] = [await newAccount('clean'), await newAccount('clean-other')]

      const doc = await draft({ type: 'expense', account, amountBani: 100, category: rent, toAccount: other, supplier })

      expect(doc.toAccount ?? null).toBeNull()
      expect(doc.supplier ?? null).toBeNull()
    })
  })

  describe('supplier_payment', () => {
    it('проведення зменшує касу, сторно повертає', async () => {
      const account = await newAccount('supplier')
      await fund(account, 100000)
      const doc = await draft({ type: 'supplier_payment', account, amountBani: 100000, supplier })

      await post(doc.id)
      expect(await balanceOf(account)).toBe(0)
      expect((await movesOf(doc.id)).map((move) => move.deltaBani)).toEqual([-100000])

      await reverse(doc.id)
      expect(await balanceOf(account)).toBe(100000)
    })

    it('постачальник обов\'язковий', async () => {
      const account = await newAccount('supplier-none')

      await expect(draft({ type: 'supplier_payment', account, amountBani: 100 })).rejects.toThrow(/supplier/)
    })
  })

  describe('transfer', () => {
    it('проведення переносить суму між касами двома рухами', async () => {
      const [from, to] = [await newAccount('trf-from'), await newAccount('trf-to')]
      await fund(from, 30000)
      const doc = await draft({ type: 'transfer', account: from, toAccount: to, amountBani: 12345 })

      await post(doc.id)

      expect(await balanceOf(from)).toBe(17655)
      expect(await balanceOf(to)).toBe(12345)
      expect((await movesOf(doc.id)).map((move) => [String(move.account), move.deltaBani]).sort()).toEqual(
        [
          [from, -12345],
          [to, 12345],
        ].sort(),
      )
    })

    it('атомарний: нестача в джерелі не змінює жодну касу й не пише журнал', async () => {
      const [from, to] = [await newAccount('trf-short-from'), await newAccount('trf-short-to')]
      await fund(from, 1000)
      const doc = await draft({ type: 'transfer', account: from, toAccount: to, amountBani: 1001 })

      await expect(post(doc.id)).rejects.toThrow(/Insufficient funds/)

      expect(await balanceOf(from)).toBe(1000)
      expect(await balanceOf(to)).toBe(0)
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await statusOf(doc.id)).toBe('draft')
    })

    it('сторно дзеркальне; якщо з каси-отримувача вже витрачено, сторно відхилене', async () => {
      const [from, to] = [await newAccount('trf-rev-from'), await newAccount('trf-rev-to')]
      await fund(from, 5000)
      const first = await draft({ type: 'transfer', account: from, toAccount: to, amountBani: 3000 })
      await post(first.id)

      await reverse(first.id)
      expect([await balanceOf(from), await balanceOf(to)]).toEqual([5000, 0])

      const second = await draft({ type: 'transfer', account: from, toAccount: to, amountBani: 3000 })
      await post(second.id)
      const spent = await draft({ type: 'expense', account: to, amountBani: 1000, category: rent })
      await post(spent.id)

      await expect(reverse(second.id)).rejects.toThrow(/Insufficient funds/)
      expect([await balanceOf(from), await balanceOf(to)]).toEqual([2000, 2000])
      expect(await statusOf(second.id)).toBe('posted')
      expect(await movesOf(second.id)).toHaveLength(2)
    })

    it('каса-отримувач обов\'язкова й відрізняється від джерела', async () => {
      const account = await newAccount('trf-same')

      await expect(draft({ type: 'transfer', account, amountBani: 100 })).rejects.toThrow(/destination/)
      await expect(draft({ type: 'transfer', account, toAccount: account, amountBani: 100 })).rejects.toThrow(/must differ/)
    })
  })

  describe('баланс каси', () => {
    it('allowNegative = false: витрата понад баланс відхилена, документ лишається чернеткою', async () => {
      const account = await newAccount('floor')
      await fund(account, 500)
      const doc = await draft({ type: 'expense', account, amountBani: 501, category: rent })

      const error = await post(doc.id).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(InsufficientCashError)
      expect(error).toMatchObject({
        status: 409,
        message: expect.stringMatching(/Insufficient funds/),
        data: { code: 'INSUFFICIENT_CASH', account, requested: 501, available: 500 },
      })
      expect(await balanceOf(account)).toBe(500)
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await statusOf(doc.id)).toBe('draft')
    })

    it('allowNegative = true: каса може піти в мінус', async () => {
      const account = await newAccount('negative', { allowNegative: true })
      const doc = await draft({ type: 'supplier_payment', account, amountBani: 700, supplier })

      await post(doc.id)

      expect(await balanceOf(account)).toBe(-700)
    })

    it('паралельне проведення двох витрат не перевищує баланс', async () => {
      const account = await newAccount('race')
      await fund(account, 1000)
      const [a, b] = [
        await draft({ type: 'expense', account, amountBani: 600, category: rent }),
        await draft({ type: 'expense', account, amountBani: 600, category: rent }),
      ]

      const results = await Promise.allSettled([post(a.id), post(b.id)])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await balanceOf(account)).toBe(400)
    })

    it('сума має бути додатною цілою кількістю бані', async () => {
      const account = await newAccount('amount')

      for (const amountBani of [0, -100, 10.5]) {
        await expect(draft({ type: 'expense', account, amountBani, category: rent })).rejects.toThrow()
      }
    })
  })

  describe('operationDate і транзакція', () => {
    it('рух cash-moves датується operationDate, сторно — моментом сторно', async () => {
      const account = await newAccount('date')
      await fund(account, 1000)
      const operationDate = '2026-10-20T12:00:00.000Z'
      const doc = await draft({ type: 'expense', account, amountBani: 100, category: rent, operationDate })

      await post(doc.id)
      const before = Date.now()
      await reverse(doc.id)

      const [original, mirror] = await movesOf(doc.id)
      expect(original.date).toBe(operationDate)
      expect(new Date(mirror.date).getTime()).toBeGreaterThanOrEqual(before - 1000)
    })

    it('дата в майбутньому відхиляється', async () => {
      const account = await newAccount('future')
      const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

      await expect(
        draft({ type: 'expense', account, amountBani: 100, category: rent, operationDate: tomorrow }),
      ).rejects.toThrow(/future/)
    })

    it('операція в закритому періоді відхиляється: і чернетка, і проведення', async () => {
      const account = await newAccount('locked')
      await fund(account, 1000)
      const doc = await draft({ type: 'expense', account, amountBani: 100, category: rent })

      await setLockedUntil('2026-10-25T23:59:59.000Z')
      try {
        await expect(post(doc.id)).rejects.toThrow(/locked/)
        await expect(
          draft({ type: 'expense', account, amountBani: 100, category: rent, operationDate: '2026-10-24T12:00:00.000Z' }),
        ).rejects.toThrow(/locked/)
      } finally {
        await setLockedUntil(lockedUntilBefore ?? null)
      }

      expect(await balanceOf(account)).toBe(1000)
      expect(await statusOf(doc.id)).toBe('draft')
    })

    it('після відкату транзакції cash-moves і balanceBani незмінні', async () => {
      const [from, to] = [await newAccount('rollback-from'), await newAccount('rollback-to')]
      await fund(from, 2000)
      const doc = await draft({ type: 'transfer', account: from, toAccount: to, amountBani: 1500 })

      const req = await createLocalReq({ user: admin }, payload)
      await initTransaction(req)
      await payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, req, overrideAccess: false })
      await killTransaction(req)

      expect([await balanceOf(from), await balanceOf(to)]).toEqual([2000, 0])
      expect(await movesOf(doc.id)).toHaveLength(0)
      expect(await statusOf(doc.id)).toBe('draft')
    })
  })

  describe('доступ і незмінність', () => {
    it('читання й створення лише для admin', async () => {
      const read = (user: User | null) => payload.find({ collection: 'cash-operations', overrideAccess: false, user })

      await expect(read(asUser(['admin']))).resolves.toBeDefined()
      await expect(read(asUser(['customer']))).rejects.toThrow()
      await expect(read(null)).rejects.toThrow()

      const account = await newAccount('access')
      await expect(
        payload.create({
          collection: 'cash-operations',
          data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', type: 'expense', account, amountBani: 100, category: rent },
          overrideAccess: false,
          user: asUser(['customer']),
        }),
      ).rejects.toThrow()
    })

    it('проведена операція не змінюється й не видаляється', async () => {
      const account = await newAccount('frozen')
      await fund(account, 1000)
      const doc = await draft({ type: 'expense', account, amountBani: 100, category: rent })
      await post(doc.id)

      await expect(
        payload.update({ collection: 'cash-operations', id: doc.id, data: { amountBani: 50 }, ...asAdmin }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'cash-operations', id: doc.id, ...asAdmin })).rejects.toThrow()
      expect(await balanceOf(account)).toBe(900)
    })
  })

  describe('manager (В19)', () => {
    let other: User
    let customer: string

    const as = (user: User) => ({ user: { ...user, collection: 'users' } as User, overrideAccess: false }) as const

    const managerDraft = async (fields: DraftData, user = manager) => {
      const doc = await payload.create({
        collection: 'cash-operations',
        data: { status: 'draft', operationDate: '2026-10-25T00:00:00.000Z', ...fields },
        ...as(user),
      })
      operations.push(doc.id)
      return doc
    }

    const managerPost = (id: number | string, user = manager) =>
      payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...as(user) })

    beforeAll(async () => {
      other = await payload.update({ collection: 'users', id: (await data.user()).id, data: { roles: ['manager'] } })
      customer = String((await data.user()).id)
    })

    afterAll(async () => {
      await payload.delete({ collection: 'customer-moves', where: { customer: { equals: customer } } })
      await payload.delete({ collection: 'customer-balances', where: { customer: { equals: customer } } })
    })

    it('проводить витрату й надходження від клієнта; автор = manager; сторнувати не може', async () => {
      const account = await newAccount('manager')
      await fund(account, 10000)

      const expense = await managerDraft({ type: 'expense', account, amountBani: 1500, category: rent })
      expect(expense.createdBy).toEqual(expect.objectContaining({ id: manager.id }))
      expect((await managerPost(expense.id)).status).toBe('posted')

      const receipt = await managerDraft({ type: 'customer_receipt', account, amountBani: 4000, customer })
      expect((await managerPost(receipt.id)).status).toBe('posted')

      expect(await balanceOf(account)).toBe(12500)

      await expect(
        payload.update({
          collection: 'cash-operations',
          id: expense.id,
          data: { status: 'reversed', reversalReason: 'mistake' },
          ...as(manager),
        }),
      ).rejects.toThrow()
      expect(await statusOf(expense.id)).toBe('posted')
    })

    it('інші типи й статті зарплати заборонені', async () => {
      const account = await newAccount('manager-denied')
      const toAccount = await newAccount('manager-denied-to')

      for (const fields of [
        { type: 'transfer', account, toAccount, amountBani: 100 },
        { type: 'supplier_payment', account, supplier, amountBani: 100 },
        { type: 'customer_refund', account, customer, amountBani: 100 },
      ] as DraftData[]) {
        await expect(managerDraft(fields), fields.type).rejects.toThrow(/only expenses and customer receipts/)
      }

      await expect(managerDraft({ type: 'expense', account, amountBani: 100, category: salary })).rejects.toThrow()

      // Чернетку admin зі статтею зарплати manager не проведе й не побачить.
      const salaryDraft = await draft({ type: 'expense', account, amountBani: 100, category: salary, manager: manager.id })
      await expect(managerPost(salaryDraft.id)).rejects.toThrow()
      expect(await statusOf(salaryDraft.id)).toBe('draft')
    })

    it('бачить і змінює лише свої чернетки; admin бачить усі', async () => {
      const account = await newAccount('manager-own')
      const own = await managerDraft({ type: 'expense', account, amountBani: 100, category: rent })
      const foreign = await managerDraft({ type: 'expense', account, amountBani: 200, category: rent }, other)
      const byAdmin = await draft({ type: 'expense', account, amountBani: 300, category: rent })

      const visible = async (user: User) =>
        (
          await payload.find({ collection: 'cash-operations', where: { account: { equals: account } }, depth: 0, ...as(user) })
        ).docs.map((doc) => doc.id)

      expect(await visible(manager)).toEqual([own.id])
      expect((await visible(admin)).sort()).toEqual([own.id, foreign.id, byAdmin.id].sort())

      await expect(
        payload.update({ collection: 'cash-operations', id: foreign.id, data: { amountBani: 1 }, ...as(manager) }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'cash-operations', id: foreign.id, ...as(manager) })).rejects.toThrow()

      await payload.update({ collection: 'cash-operations', id: own.id, data: { amountBani: 150 }, ...as(manager) })
      await payload.delete({ collection: 'cash-operations', id: own.id, ...as(manager) })
      await expect(payload.findByID({ collection: 'cash-operations', id: own.id })).rejects.toThrow()
    })

    it('«Прийняти оплату»: manager отримує свою чернетку надходження, повторно ту саму, і проводить її', async () => {
      const account = await newAccount('manager-accept')
      const order = await insertOrder(payload, { customer, revenueBani: 2500, stockPostedAt: new Date() })
      orders.push(order)

      const accept = async (user: User) => {
        const req = await createLocalReq({ user: { ...user, collection: 'users' } as User }, payload)
        req.routeParams = { id: order }
        return acceptPayment.handler(req)
      }

      const first = await accept(manager)
      expect(first.status).toBe(201)
      const { id } = (await first.json()) as { id: string }
      operations.push(id)

      const again = await accept(manager)
      expect(again.status).toBe(200)
      expect(((await again.json()) as { id: string }).id).toBe(id)

      // Чужу чернетку інший менеджер не відкрив би, тож отримує свою.
      const foreign = await accept(other)
      expect(foreign.status).toBe(201)
      const foreignId = ((await foreign.json()) as { id: string }).id
      operations.push(foreignId)
      expect(foreignId).not.toBe(id)

      const receipt = await payload.findByID({ collection: 'cash-operations', id, depth: 0, ...as(manager) })
      expect(receipt).toMatchObject({ type: 'customer_receipt', order, amountBani: 2500, createdBy: manager.id })

      // Каса з налаштувань може бути іншою; для перевірки балансу ставимо свою.
      await payload.update({ collection: 'cash-operations', id, data: { account }, ...as(manager) })
      await managerPost(id)
      expect(await balanceOf(account)).toBe(2500)
      expect((await payload.findByID({ collection: 'orders', id: order, depth: 0 })).paymentState).toBe('paid')
    })

    it('каси без залишку; статті без зарплатних', async () => {
      const account = await newAccount('manager-read')
      await fund(account, 700)

      const cash = await payload.findByID({ collection: 'cash-accounts', id: account, ...as(manager) })
      expect(cash.name).toBe(`${tag} manager-read`)
      expect(cash.balanceBani).toBeUndefined()

      const { docs } = await payload.find({
        collection: 'expense-categories',
        where: { id: { in: [rent, salary] } },
        depth: 0,
        ...as(manager),
      })
      expect(docs.map((doc) => doc.id)).toEqual([rent])
    })
  })
})
