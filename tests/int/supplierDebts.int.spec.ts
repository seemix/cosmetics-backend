import { createLocalReq, getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import type { CashOperation } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { getSupplierDebt, listSupplierDebts } from '@/services/finance/debts.service'

import { TestData } from './helpers/fixtures'
import { type AuthUser, cleanupStock, createAdmin, deleteDocumentsDirectly, inTransaction } from './helpers/stock'

let payload: Payload
let data: TestData
let admin: AuthUser
let brandId: string
let warehouseId: string
let accountId: string

const tag = `SDBT-${Date.now()}`
const products: string[] = []
const suppliers: string[] = []
const purchases: Array<number | string> = []
const openings: Array<number | string> = []
const operations: Array<number | string> = []
const fundingDoc = { collection: 'test-docs', id: 'supplier-debts-funding' }

const asAdmin = {
  get user() {
    return admin
  },
  overrideAccess: false,
} as const

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const newSupplier = async (suffix: string) => {
  const id = String((await payload.create({ collection: 'suppliers', data: { name: `${tag} ${suffix}` } })).id)
  suppliers.push(id)
  return id
}

const debtOf = async (supplier: string, asOf?: Date) =>
  getSupplierDebt(await createLocalReq({}, payload), supplier, asOf)

/** Накладна з прикладу дизайну: товар 2 327,20 і логістика 150,00 (`payee`). */
const newPurchase = async (supplier: string, extra: Array<{ amountBani: number; payee: string }> = []) => {
  const lines = []
  for (const [quantity, unitPriceBani] of [
    [10, 12000],
    [5, 7550],
    [3, 24990],
  ]) {
    const product = String((await data.product({ brand: brandId, retailPrice: 100 })).id)
    products.push(product)
    lines.push({ product, quantity, unitPriceBani })
  }

  const doc = await payload.create({
    collection: 'purchases',
    data: {
      status: 'draft',
      documentDate: '2026-10-20T00:00:00.000Z',
      supplier,
      warehouse: warehouseId,
      allocationBase: 'amount',
      lines,
      extraCosts: extra.map((cost) => ({ description: 'Logistics', ...cost })),
    },
    ...asAdmin,
  })
  purchases.push(doc.id)
  return doc
}

const postPurchase = (id: number | string) =>
  payload.update({ collection: 'purchases', id, data: { status: 'posted' }, ...asAdmin })

const reversePurchase = (id: number | string) =>
  payload.update({
    collection: 'purchases',
    id,
    data: { status: 'reversed', reversalReason: 'wrong invoice' },
    ...asAdmin,
  })

const newPayment = async (supplier: string, amountBani: number, status: 'draft' | 'posted' = 'posted') => {
  await inTransaction(payload, (req) =>
    applyCashMoves(req, { doc: fundingDoc, lines: [{ account: accountId, deltaBani: amountBani }] }),
  )
  const doc = await payload.create({
    collection: 'cash-operations',
    data: {
      status: 'draft',
      operationDate: '2026-10-25T00:00:00.000Z',
      type: 'supplier_payment',
      account: accountId,
      amountBani,
      supplier,
    } as Partial<CashOperation> as never,
    ...asAdmin,
  })
  operations.push(doc.id)

  if (status === 'draft') return doc
  return payload.update({ collection: 'cash-operations', id: doc.id, data: { status: 'posted' }, ...asAdmin })
}

const reversePayment = (id: number | string) =>
  payload.update({
    collection: 'cash-operations',
    id,
    data: { status: 'reversed', reversalReason: 'entered by mistake' },
    ...asAdmin,
  })

const newOpening = async (lines: Array<{ supplier: string; amountBani: number }>) => {
  const doc = await payload.create({
    collection: 'opening-balances',
    data: { kind: 'supplierDebt', status: 'draft', documentDate: '2026-10-20T00:00:00.000Z', supplierLines: lines },
    ...asAdmin,
  })
  openings.push(doc.id)
  return doc
}

const postOpening = (id: number | string) =>
  payload.update({ collection: 'opening-balances', id, data: { status: 'posted' }, ...asAdmin })

const reverseOpening = (id: number | string) =>
  payload.update({
    collection: 'opening-balances',
    id,
    data: { status: 'reversed', reversalReason: 'wrong debt' },
    ...asAdmin,
  })

describe('C4: борги постачальникам', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    admin = await createAdmin(payload, data)
    brandId = String((await data.brand()).id)
    warehouseId = String(
      (await payload.create({ collection: 'warehouses', data: { name: `${tag} wh`, code: `${tag}-wh` } })).id,
    )
    accountId = String(
      (
        await payload.create({
          collection: 'cash-accounts',
          data: { name: `${tag} cash`, code: `${tag}-cash`, kind: 'cash' },
        })
      ).id,
    )
  })

  afterAll(async () => {
    await deleteDocumentsDirectly(payload, 'purchases', purchases)
    await deleteDocumentsDirectly(payload, 'opening-balances', openings)
    await deleteDocumentsDirectly(payload, 'cash-operations', operations)
    await payload.delete({ collection: 'cash-moves', where: { account: { equals: accountId } } })
    await payload.delete({ collection: 'cash-accounts', where: { id: { equals: accountId } } })
    await cleanupStock(payload, products, [warehouseId])
    await payload.delete({ collection: 'suppliers', where: { id: { in: suppliers } } })
    await data.cleanup()
  })

  it('приклад дизайну: накладна 2 327,20 + логістика 150,00 перевізнику, оплата 1 000,00', async () => {
    const [supplier, carrier] = [await newSupplier('supplier'), await newSupplier('carrier')]
    const purchase = await newPurchase(supplier, [{ amountBani: 15000, payee: carrier }])
    await postPurchase(purchase.id)
    await newPayment(supplier, 100000)

    expect(await debtOf(supplier)).toEqual({
      supplier,
      goodsBani: 232720,
      extraBani: 0,
      openingBani: 0,
      paidBani: 100000,
      debtBani: 132720,
    })
    expect(await debtOf(carrier)).toMatchObject({ goodsBani: 0, extraBani: 15000, paidBani: 0, debtBani: 15000 })
  })

  it('логістика з payee = той самий постачальник додається до його боргу', async () => {
    const supplier = await newSupplier('same-payee')
    await postPurchase((await newPurchase(supplier, [{ amountBani: 15000, payee: supplier }])).id)

    expect(await debtOf(supplier)).toMatchObject({ goodsBani: 232720, extraBani: 15000, debtBani: 247720 })
  })

  it('listSupplierDebts повертає всіх постачальників з рухом', async () => {
    const [supplier, carrier] = [await newSupplier('list-s'), await newSupplier('list-c')]
    await postPurchase((await newPurchase(supplier, [{ amountBani: 15000, payee: carrier }])).id)

    const list = await listSupplierDebts(await createLocalReq({}, payload))
    const mine = Object.fromEntries(list.filter((row) => [supplier, carrier].includes(row.supplier)).map((row) => [row.supplier, row.debtBani]))

    expect(mine).toEqual({ [supplier]: 232720, [carrier]: 15000 })
  })

  it('сторновані закупівля й оплата не враховуються', async () => {
    const supplier = await newSupplier('reversed')
    const purchase = await postPurchase((await newPurchase(supplier)).id)
    const payment = await newPayment(supplier, 50000)

    expect((await debtOf(supplier)).debtBani).toBe(182720)

    await reversePayment(payment.id)
    expect((await debtOf(supplier)).debtBani).toBe(232720)

    await reversePurchase(purchase.id)
    expect(await debtOf(supplier)).toMatchObject({ goodsBani: 0, paidBani: 0, debtBani: 0 })
  })

  it('сторно після asOf на asOf ще враховується', async () => {
    const supplier = await newSupplier('as-of')
    const before = new Date()
    await sleep(20)
    const purchase = await postPurchase((await newPurchase(supplier)).id)
    const payment = await newPayment(supplier, 50000)
    await sleep(20)
    const between = new Date()
    await sleep(20)
    await reversePurchase(purchase.id)
    await reversePayment(payment.id)

    // Закупівля рахується за postedAt (ще не проведена), а оплата за operationDate (2026-10-25, уже настала).
    expect((await debtOf(supplier, before)).debtBani).toBe(-50000)
    expect((await debtOf(supplier, between)).debtBani).toBe(182720)
    expect((await debtOf(supplier)).debtBani).toBe(0)
  })

  it('аванс: мінусовий рядок і переплата дають від\'ємний борг', async () => {
    const [byOpening, byPayment] = [await newSupplier('advance-opening'), await newSupplier('advance-payment')]
    await postOpening((await newOpening([{ supplier: byOpening, amountBani: -50000 }])).id)
    await postPurchase((await newPurchase(byPayment)).id)
    await newPayment(byPayment, 300000)

    expect(await debtOf(byOpening)).toMatchObject({ openingBani: -50000, debtBani: -50000 })
    expect((await debtOf(byPayment)).debtBani).toBe(-67280)
  })

  it('початковий борг додається до боргу', async () => {
    const supplier = await newSupplier('opening')
    await postOpening((await newOpening([{ supplier, amountBani: 80000 }])).id)

    expect(await debtOf(supplier)).toMatchObject({ openingBani: 80000, debtBani: 80000 })
  })

  it('чернетки не враховуються', async () => {
    const supplier = await newSupplier('drafts')
    await newPurchase(supplier)
    await newOpening([{ supplier, amountBani: 80000 }])
    await newPayment(supplier, 1000, 'draft')

    expect(await debtOf(supplier)).toMatchObject({ goodsBani: 0, openingBani: 0, paidBani: 0, debtBani: 0 })
  })

  it('усі суми цілі бані', async () => {
    const [supplier, carrier] = [await newSupplier('whole'), await newSupplier('whole-c')]
    await postPurchase((await newPurchase(supplier, [{ amountBani: 15001, payee: carrier }])).id)

    const debt = await debtOf(supplier)
    for (const row of [debt, await debtOf(carrier)]) {
      for (const key of ['goodsBani', 'extraBani', 'openingBani', 'paidBani', 'debtBani'] as const) {
        expect(Number.isInteger(row[key])).toBe(true)
      }
    }
    expect((await debtOf(carrier)).debtBani).toBe(15001)
  })

  describe('opening-balances supplierDebt', () => {
    it('нульова сума відхиляється', async () => {
      const supplier = await newSupplier('zero')

      await expect(newOpening([{ supplier, amountBani: 0 }])).rejects.toThrow()
    })

    it('дубль постачальника в одному документі відхиляється', async () => {
      const supplier = await newSupplier('dup-in-doc')

      await expect(
        newOpening([
          { supplier, amountBani: 100 },
          { supplier, amountBani: 200 },
        ]),
      ).rejects.toThrow(/supplier/i)
    })

    it('проведення відхиляється, якщо в іншому проведеному документі вже є рядок постачальника', async () => {
      const supplier = await newSupplier('dup-across')
      const first = await newOpening([{ supplier, amountBani: 100 }])
      const second = await newOpening([{ supplier, amountBani: 200 }])

      await postOpening(first.id)
      await expect(postOpening(second.id)).rejects.toThrow(/active opening debt/)
      expect((await debtOf(supplier)).openingBani).toBe(100)

      // Після сторно першого документа рядок більше не активний.
      await reverseOpening(first.id)
      await postOpening(second.id)
      expect((await debtOf(supplier)).openingBani).toBe(200)
    })
  })
})
