// @vitest-environment node
// jose (підпис JWT для REST-запитів) не працює з TextEncoder середовища jsdom.
import { createLocalReq, getPayload, handleEndpoints, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SalarySchemes } from '@/collections/Salary/SalarySchemes'
import { Payrolls } from '@/collections/Salary/Payrolls'
import { checkCashCache, fixCashCache } from '@/endpoints/cashCacheCheck'
import config from '@/payload.config'
import type { Payroll } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { getManagerDebt, listManagerDebts } from '@/services/finance/debts.service'
import { changePayrollPaid } from '@/services/salary/payrollPayments.service'

import { TestData } from './helpers/fixtures'
import { insertOrder, makeUser, rejectsWith } from './helpers/salary'
import { deleteDocumentsDirectly, inTransaction, type AuthUser } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let customer: AuthUser
let account: string
let salary: string
let rent: string
let previousLockedUntil: string | null = null

const PASSWORD = 'test-password-123'
const tag = `PAY-${Date.now()}`
const orders: string[] = []
const schemes: string[] = []
const payrolls: string[] = []
const operations: Array<number | string> = []
const categories: string[] = []

const SEP = { periodFrom: '2026-09-01T00:00:00.000Z', periodTo: '2026-09-30T00:00:00.000Z' }
const OCT = { periodFrom: '2026-10-01T00:00:00.000Z', periodTo: '2026-10-31T00:00:00.000Z' }
const MID_SEPTEMBER = new Date('2026-09-15T09:00:00.000Z')
const PAY_DATE = '2026-10-20T00:00:00.000Z'

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const idOf = (value: unknown) => String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

const manager = () => makeUser(payload, data, ['manager'])

const scheme = async (fields: Record<string, unknown>) => {
  const doc = await payload.create({
    collection: 'salary-schemes',
    data: {
      name: `${tag} scheme`,
      percentBp: 1000,
      base: 'revenue',
      dateBasis: 'order_date',
      attribution: 'snapshot',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      ...fields,
    } as never,
    depth: 0,
  })
  schemes.push(String(doc.id))
  return String(doc.id)
}

const sale = async (m: AuthUser, revenueBani: number) => {
  const id = await insertOrder(payload, { manager: String(m.id), stockPostedAt: MID_SEPTEMBER, revenueBani })
  orders.push(id)
  return id
}

const draftPayroll = async (m: AuthUser, fields: Record<string, unknown> = {}): Promise<Payroll> => {
  const doc = await payload.create({ collection: 'payrolls', data: { manager: m.id, ...SEP, ...fields } as never, depth: 0, ...asAdmin })
  payrolls.push(String(doc.id))
  return doc
}

const updatePayroll = (id: string, changes: Record<string, unknown>) =>
  payload.update({ collection: 'payrolls', id, data: changes as never, depth: 0, ...asAdmin })

const postPayroll = (id: string) => updatePayroll(id, { status: 'posted' })
const reversePayroll = (id: string) => updatePayroll(id, { status: 'reversed', reversalReason: 'test' })
const payrollOf = (id: string) => payload.findByID({ collection: 'payrolls', id, depth: 0 })

/** Розрахунок, проведений із заданою сумою: схема з окладом `fixedBani` без відсотка. */
const postedPayroll = async (m: AuthUser, fixedBani: number, period = SEP) => {
  await scheme({ manager: String(m.id), fixedBani, percentBp: 0 })
  const doc = await draftPayroll(m, period)
  return postPayroll(String(doc.id))
}

const salaryDraft = async (fields: { manager: AuthUser; amountBani: number; payroll?: string | null; category?: string }) => {
  const doc = await payload.create({
    collection: 'cash-operations',
    data: {
      status: 'draft',
      type: 'expense',
      operationDate: PAY_DATE,
      account,
      category: fields.category ?? salary,
      manager: fields.manager.id,
      payroll: fields.payroll ?? null,
      amountBani: fields.amountBani,
    } as never,
    ...asAdmin,
  })
  operations.push(doc.id)
  return doc
}

const postOperation = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'posted' }, ...asAdmin })

const reverseOperation = (id: number | string) =>
  payload.update({ collection: 'cash-operations', id, data: { status: 'reversed', reversalReason: 'test' }, ...asAdmin })

const pay = async (fields: Parameters<typeof salaryDraft>[0]) => postOperation((await salaryDraft(fields)).id)

const rest = async (path: string, user?: AuthUser) => {
  const headers: Record<string, string> = {}
  if (user) {
    const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: PASSWORD } })
    headers.Authorization = `Bearer ${token}`
  }
  const response = await handleEndpoints({ config, request: new Request(`http://localhost/api${path}`, { headers }) })
  return { status: response.status, body: (await response.json()) as any }
}

describe('M4 (2/2): розрахунки зарплати, виплати, доступи', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await makeUser(payload, data, ['admin'])
    customer = await makeUser(payload, data, ['customer'])

    const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previousLockedUntil = settings.lockedUntil ?? null
    await payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil: null } as never })

    account = String(
      (await payload.create({ collection: 'cash-accounts', data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' } })).id,
    )
    await inTransaction(payload, (req) =>
      applyCashMoves(req, { doc: { collection: 'test-docs', id: tag }, lines: [{ account, deltaBani: 100_000_000 }] }),
    )

    salary = String(
      (await payload.create({ collection: 'expense-categories', data: { name: `${tag} salary`, code: `${tag}-salary`, isSalary: true } })).id,
    )
    rent = String((await payload.create({ collection: 'expense-categories', data: { name: `${tag} rent`, code: `${tag}-rent` } })).id)
    categories.push(salary, rent)
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'cash-moves', where: { account: { equals: account } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { equals: account } } })
    await payload.delete({ collection: 'expense-categories', where: { id: { in: categories } } })
    await deleteDocumentsDirectly(payload, 'payrolls', payrolls)
    await deleteDocumentsDirectly(payload, 'salary-schemes', schemes)
    await deleteDocumentsDirectly(payload, 'orders', orders)
    await payload.updateGlobal({ slug: 'accounting-settings', data: { lockedUntil: previousLockedUntil } as never })
    await data.cleanup()
  })

  describe('чернетка й проведення', () => {
    it('чернетка перераховується при кожному збереженні: нове замовлення, зміна схеми', async () => {
      const m = await manager()
      const schemeId = await scheme({ manager: String(m.id), fixedBani: 100000, percentBp: 1000 })
      await sale(m, 50000)

      const created = await draftPayroll(m)
      expect(created.number).toMatch(/^PAY-\d{6}$/)
      expect(idOf(created.scheme)).toBe(schemeId)
      expect([created.fixedBani, created.baseTotalBani, created.percentAmountBani, created.totalBani]).toEqual([100000, 50000, 5000, 105000])
      expect(created.lines).toHaveLength(1)

      await sale(m, 30000)
      const afterOrder = await updatePayroll(String(created.id), { comment: 'recalc' })
      expect([afterOrder.baseTotalBani, afterOrder.percentAmountBani, afterOrder.totalBani]).toEqual([80000, 8000, 108000])

      await payload.update({ collection: 'salary-schemes', id: schemeId, data: { percentBp: 1500, fixedBani: 0 } as never })
      const afterScheme = await updatePayroll(String(created.id), { comment: 'recalc 2' })
      expect([afterScheme.fixedBani, afterScheme.percentAmountBani, afterScheme.totalBani]).toEqual([0, 12000, 12000])
      expect(afterScheme.schemeSnapshot).toMatchObject({ id: schemeId, percentBp: 1500, base: 'revenue' })
    })

    it('схема: за замовчуванням, якщо в менеджера своєї немає; явно чужа відхиляється; без схеми помилка', async () => {
      const [m, other] = [await manager(), await manager()]
      const othersScheme = await scheme({ manager: String(other.id) })
      // Схема за замовчуванням у далекому році, щоб не впливати на інші тести.
      const fallback = await scheme({ validFrom: '2039-01-01T00:00:00.000Z', validTo: '2039-12-31T00:00:00.000Z', fixedBani: 700 })
      const period = { periodFrom: '2039-03-01T00:00:00.000Z', periodTo: '2039-03-31T00:00:00.000Z' }

      const byDefault = await draftPayroll(m, period)
      expect(idOf(byDefault.scheme)).toBe(fallback)
      expect(byDefault.totalBani).toBe(700)

      await rejectsWith(updatePayroll(String(byDefault.id), { scheme: othersScheme }), 'custom:error:payrollSchemeInvalid')
      await rejectsWith(
        draftPayroll(m, { periodFrom: '2044-03-01T00:00:00.000Z', periodTo: '2044-03-31T00:00:00.000Z' }),
        'custom:error:salarySchemeNotFound',
      )
    })

    it('корекція: без коментаря відхиляється; з коментарем (і від\'ємна) входить у totalBani', async () => {
      const m = await manager()
      await scheme({ manager: String(m.id), fixedBani: 100000, percentBp: 0 })

      await rejectsWith(draftPayroll(m, { adjustmentsBani: 5000 }), 'custom:error:payrollAdjustmentComment')
      const withBonus = await draftPayroll(m, { adjustmentsBani: 5000, comment: 'bonus' })
      expect(withBonus.totalBani).toBe(105000)

      const withPenalty = await updatePayroll(String(withBonus.id), { adjustmentsBani: -20000, comment: 'penalty' })
      expect(withPenalty.totalBani).toBe(80000)
      await rejectsWith(updatePayroll(String(withBonus.id), { comment: '' }), 'custom:error:payrollAdjustmentComment')
    })

    it('кінець періоду раніше початку відхиляється', async () => {
      const m = await manager()
      await scheme({ manager: String(m.id) })
      await rejectsWith(draftPayroll(m, { periodFrom: OCT.periodFrom, periodTo: SEP.periodTo }), 'custom:error:payrollPeriodInvalid')
    })

    it('проведений незмінний: знімок і рядки збережені, зміна схеми й замовлень його не змінює', async () => {
      const m = await manager()
      const schemeId = await scheme({ manager: String(m.id), fixedBani: 100000, percentBp: 1000 })
      const orderId = await sale(m, 40000)

      const posted = await postPayroll(String((await draftPayroll(m)).id))
      expect(posted.status).toBe('posted')
      expect(posted.totalBani).toBe(104000)
      expect(posted.lines?.map((line) => [idOf(line.order), line.baseBani, line.amountBani])).toEqual([[orderId, 40000, 4000]])
      expect(posted.schemeSnapshot).toMatchObject({ id: schemeId, fixedBani: 100000, percentBp: 1000, base: 'revenue' })

      for (const change of [{ adjustmentsBani: 100, comment: 'x' }, { comment: 'changed' }, { periodFrom: '2026-09-02T00:00:00.000Z' }]) {
        await rejectsWith(updatePayroll(String(posted.id), change), 'custom:error:postedImmutable')
      }
      await rejectsWith(updatePayroll(String(posted.id), { status: 'draft' }), 'custom:error:postedOnlyReverse')
      await expect(payload.delete({ collection: 'payrolls', id: posted.id, ...asAdmin })).rejects.toThrow()

      await payload.update({ collection: 'salary-schemes', id: schemeId, data: { percentBp: 5000, fixedBani: 0 } as never })
      await sale(m, 99999)

      const reread = await payrollOf(String(posted.id))
      expect([reread.totalBani, reread.lines?.length]).toEqual([104000, 1])
      expect(reread.schemeSnapshot).toEqual(posted.schemeSnapshot)
    })

    it('проведення з перетином періоду того самого менеджера відхиляється; суміжний період і інший менеджер проходять', async () => {
      const [m, other] = [await manager(), await manager()]
      await scheme({ manager: String(m.id) })
      await scheme({ manager: String(other.id) })
      await postPayroll(String((await draftPayroll(m)).id))

      const overlapping = await draftPayroll(m, { periodFrom: '2026-09-30T00:00:00.000Z', periodTo: '2026-10-15T00:00:00.000Z' })
      await rejectsWith(postPayroll(String(overlapping.id)), 'custom:error:payrollOverlap')
      expect((await payrollOf(String(overlapping.id))).status).toBe('draft')

      await expect(postPayroll(String((await draftPayroll(m, OCT)).id))).resolves.toMatchObject({ status: 'posted' })
      await expect(postPayroll(String((await draftPayroll(other)).id))).resolves.toMatchObject({ status: 'posted' })
    })
  })

  describe('виплати', () => {
    it('часткові виплати оновлюють paidBani; переплата відхиляється; сторно виплати повертає paidBani', async () => {
      const m = await manager()
      const payroll = String((await postedPayroll(m, 500000)).id)

      await pay({ manager: m, amountBani: 200000, payroll })
      const second = await pay({ manager: m, amountBani: 250000, payroll })
      expect((await payrollOf(payroll)).paidBani).toBe(450000)

      await rejectsWith(pay({ manager: m, amountBani: 50001, payroll }), 'custom:error:payrollOverpaid')
      expect((await payrollOf(payroll)).paidBani).toBe(450000)

      await reverseOperation(second.id)
      expect((await payrollOf(payroll)).paidBani).toBe(200000)

      await pay({ manager: m, amountBani: 300000, payroll })
      expect((await payrollOf(payroll)).paidBani).toBe(500000)
    })

    it('виплата чужому менеджеру, за чернеткою або сторнованим розрахунком відхиляється', async () => {
      const [m, other] = [await manager(), await manager()]
      const payroll = String((await postedPayroll(m, 100000)).id)
      await expect(pay({ manager: other, amountBani: 1000, payroll })).rejects.toThrow()

      await scheme({ manager: String(other.id) })
      const otherPayroll = String((await draftPayroll(other)).id)
      await expect(pay({ manager: other, amountBani: 1000, payroll: otherPayroll })).rejects.toThrow()

      await postPayroll(otherPayroll)
      await reversePayroll(otherPayroll)
      await expect(pay({ manager: other, amountBani: 1000, payroll: otherPayroll })).rejects.toThrow()

      expect((await payrollOf(payroll)).paidBani).toBe(0)
      expect((await payrollOf(otherPayroll)).paidBani).toBe(0)
    })

    it('умови виплати в самому $inc: менеджер, статус, переплата, сторно понад сплачене', async () => {
      const [m, other] = [await manager(), await manager()]
      const payroll = String((await postedPayroll(m, 100000)).id)
      await scheme({ manager: String(other.id) })
      const draft = String((await draftPayroll(other)).id)
      const change = (args: { payroll: string; manager: AuthUser; deltaBani: number }) =>
        inTransaction(payload, (req) =>
          changePayrollPaid(req, { payroll: args.payroll, manager: String(args.manager.id), deltaBani: args.deltaBani }),
        )

      await rejectsWith(change({ payroll, manager: other, deltaBani: 1000 }), 'custom:error:payrollManagerMismatch')
      await rejectsWith(change({ payroll: draft, manager: other, deltaBani: 1000 }), 'custom:error:payrollNotPosted')
      await rejectsWith(change({ payroll, manager: m, deltaBani: 100001 }), 'custom:error:payrollOverpaid')
      await rejectsWith(change({ payroll, manager: m, deltaBani: -1 }), 'custom:error:payrollPaidExceeded')

      await change({ payroll, manager: m, deltaBani: 100000 })
      expect((await payrollOf(payroll)).paidBani).toBe(100000)
      await change({ payroll, manager: m, deltaBani: -100000 })
      expect((await payrollOf(payroll)).paidBani).toBe(0)
    })

    it('аванс без payroll проходить і не змінює paidBani; payroll для не-зарплатної статті очищається', async () => {
      const m = await manager()
      const payroll = String((await postedPayroll(m, 100000)).id)

      const advance = await pay({ manager: m, amountBani: 30000 })
      expect(advance.status).toBe('posted')
      expect(advance.payroll ?? null).toBeNull()

      const rentOperation = await salaryDraft({ manager: m, amountBani: 1000, payroll, category: rent })
      expect(rentOperation.payroll ?? null).toBeNull()

      expect((await payrollOf(payroll)).paidBani).toBe(0)
    })

    it('паралельні виплати, що разом перевищують залишок, дають рівно один успіх', async () => {
      const m = await manager()
      const payroll = String((await postedPayroll(m, 100000)).id)
      const [a, b] = [
        await salaryDraft({ manager: m, amountBani: 60000, payroll }),
        await salaryDraft({ manager: m, amountBani: 60000, payroll }),
      ]

      const results = await Promise.allSettled([postOperation(a.id), postOperation(b.id)])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect((await payrollOf(payroll)).paidBani).toBe(60000)
    })
  })

  describe('сторно розрахунку', () => {
    it('з виплатами відхиляється; без виплат проходить; потім можна провести новий за той самий період', async () => {
      const m = await manager()
      const payroll = String((await postedPayroll(m, 100000)).id)
      const payment = await pay({ manager: m, amountBani: 10000, payroll })

      await rejectsWith(reversePayroll(payroll), 'custom:error:payrollHasPayments')
      expect((await payrollOf(payroll)).status).toBe('posted')

      await reverseOperation(payment.id)
      await expect(reversePayroll(payroll)).resolves.toMatchObject({ status: 'reversed', paidBani: 0 })

      await expect(postPayroll(String((await draftPayroll(m)).id))).resolves.toMatchObject({ status: 'posted', totalBani: 100000 })
    })
  })

  describe('борг менеджеру', () => {
    it('payroll 5 000,00 − виплати 3 000,00 = 2 000,00; аванс без payroll зменшує борг; asOf до сторно враховує payroll', async () => {
      const m = await manager()
      const id = String(m.id)
      const payroll = String((await postedPayroll(m, 500000)).id)
      await pay({ manager: m, amountBani: 100000, payroll })
      await pay({ manager: m, amountBani: 200000, payroll })

      expect(await getManagerDebt(await createLocalReq({}, payload), id)).toEqual({
        manager: id,
        accruedBani: 500000,
        paidBani: 300000,
        debtBani: 200000,
      })

      await pay({ manager: m, amountBani: 50000 })
      expect((await getManagerDebt(await createLocalReq({}, payload), id)).debtBani).toBe(150000)

      // Другий розрахунок за жовтень: проведено, потім сторно; на момент між ними він враховується.
      const october = await draftPayroll(m, OCT)
      await postPayroll(String(october.id))
      const between = new Date()
      await new Promise((resolve) => setTimeout(resolve, 5))
      await reversePayroll(String(october.id))

      const req = await createLocalReq({}, payload)
      expect((await getManagerDebt(req, id, between)).debtBani).toBe(650000)
      expect((await getManagerDebt(req, id)).debtBani).toBe(150000)
      expect((await listManagerDebts(req)).find((debt) => debt.manager === id)?.debtBani).toBe(150000)
    })
  })

  describe('перевірка кешу', () => {
    it('знаходить зіпсований paidBani і виправляє лише з прапорцем payrolls', async () => {
      const m = await manager()
      const payroll = String((await postedPayroll(m, 100000)).id)
      await pay({ manager: m, amountBani: 40000, payroll })

      const model = payload.db.collections['payrolls']
      await model.collection.updateOne({ _id: new model.base.Types.ObjectId(payroll) }, { $set: { paidBani: 1 } })

      const found = (await checkCashCache(await createLocalReq({}, payload))).filter((item) => item.id === payroll)
      expect(found).toEqual([{ type: 'payrollPaid', entity: 'payroll', id: payroll, number: expect.any(String), expected: 40000, actual: 1 }])

      const skipped = await fixCashCache(await createLocalReq({}, payload))
      expect(skipped.skipped.some((item) => item.id === payroll)).toBe(true)
      expect((await payrollOf(payroll)).paidBani).toBe(1)

      await fixCashCache(await createLocalReq({}, payload), { payrolls: true })
      expect((await payrollOf(payroll)).paidBani).toBe(40000)
      expect((await checkCashCache(await createLocalReq({}, payload))).some((item) => item.id === payroll)).toBe(false)
    })
  })

  describe('доступ', () => {
    let m: AuthUser
    let other: AuthUser
    let own: string
    let ownDraft: string
    let foreign: string

    beforeAll(async () => {
      ;[m, other] = [await manager(), await manager()]
      own = String((await postedPayroll(m, 1000)).id)
      ownDraft = String((await draftPayroll(m, OCT)).id)
      foreign = String((await postedPayroll(other, 2000)).id)
    })

    it('manager бачить лише свої проведені розрахунки (Local API)', async () => {
      const { docs } = await payload.find({
        collection: 'payrolls',
        where: { id: { in: [own, ownDraft, foreign] } },
        user: m,
        overrideAccess: false,
        depth: 0,
      })
      expect(docs.map((doc) => String(doc.id))).toEqual([own])

      await expect(payload.findByID({ collection: 'payrolls', id: foreign, user: m, overrideAccess: false })).rejects.toThrow()
      await expect(payload.findByID({ collection: 'payrolls', id: ownDraft, user: m, overrideAccess: false })).rejects.toThrow()
    })

    it('manager бачить лише свої проведені розрахунки (REST)', async () => {
      const list = await rest(`/payrolls?where[id][in]=${own},${ownDraft},${foreign}&depth=0`, m)
      expect(list.status).toBe(200)
      expect(list.body.docs.map((doc: { id: string }) => doc.id)).toEqual([own])

      expect((await rest(`/payrolls/${own}?depth=0`, m)).status).toBe(200)
      expect((await rest(`/payrolls/${foreign}?depth=0`, m)).status).toBe(404)
      expect((await rest(`/payrolls/${ownDraft}?depth=0`, m)).status).toBe(404)
      expect((await rest(`/payrolls?depth=0`, customer)).status).toBe(403)
      expect((await rest(`/payrolls?depth=0`)).status).toBe(403)
      expect((await rest(`/salary-schemes?depth=0`, m)).status).toBe(403)
    })

    it('manager не створює й не змінює розрахунки; customer і гість нічого не бачать; схеми недоступні manager', async () => {
      await expect(
        payload.create({ collection: 'payrolls', data: { manager: m.id, ...SEP } as never, user: m, overrideAccess: false }),
      ).rejects.toThrow()
      await expect(
        payload.update({ collection: 'payrolls', id: ownDraft, data: { comment: 'x' }, user: m, overrideAccess: false }),
      ).rejects.toThrow()
      await expect(payload.delete({ collection: 'payrolls', id: ownDraft, user: m, overrideAccess: false })).rejects.toThrow()

      for (const user of [customer, undefined]) {
        await expect(payload.find({ collection: 'payrolls', user, overrideAccess: false })).rejects.toThrow()
        await expect(payload.find({ collection: 'salary-schemes', user, overrideAccess: false })).rejects.toThrow()
      }
      await expect(payload.find({ collection: 'salary-schemes', user: m, overrideAccess: false })).rejects.toThrow()
    })

    it('сайдбар: payrolls видно manager, salary-schemes лише admin', () => {
      const hidden = (collection: { admin?: { hidden?: unknown } }, user: AuthUser) =>
        (collection.admin?.hidden as (args: { user: AuthUser }) => boolean)({ user })

      expect([hidden(Payrolls, admin), hidden(Payrolls, m), hidden(Payrolls, customer)]).toEqual([false, false, true])
      expect([hidden(SalarySchemes, admin), hidden(SalarySchemes, m)]).toEqual([false, true])
    })
  })
})
