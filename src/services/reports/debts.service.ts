import type { PayloadRequest } from 'payload'

import { getCustomerDebts, listManagerDebts, listSupplierDebts } from '@/services/finance/debts.service'

import {
  isoOrNull,
  loadByIds,
  type ObjectIdLike,
  type Paging,
  pagination,
  personName,
  readSession,
  reportHeader,
  toObjectId,
  USER_PROJECTION,
  type UserDoc,
} from './common'

/**
 * Борги (розд. 6.3, 12) через наявні сервіси C4, C5, M4, формули тут не дублюються.
 * Знак у назві поля: `weOweBani` — ми винні (постачальникам, менеджерам; мінус = аванс/переплата),
 * `owedToUsBani` — нам винні (покупці). Постачальники й менеджери на `asOf`, покупці лише поточний стан.
 */

export type DebtsFilters = { asOf: { day: string | null; at: Date }; includeZero: boolean }

export type SupplierDebtItem = {
  supplier: string
  name: string | null
  goodsBani: number
  extraBani: number
  openingBani: number
  paidBani: number
  weOweBani: number
}

export type ManagerDebtItem = { manager: string; name: string | null; accruedBani: number; paidBani: number; weOweBani: number }

export type CustomerDebtOrder = { order: string; number: string | null; capBani: number; paidBani: number; owedToUsBani: number }

export type CustomerDebtItem = {
  /** `null` — гостьові замовлення одним рядком. */
  customer: string | null
  name: string | null
  email: string | null
  ordersCount: number
  owedToUsBani: number
  orders: CustomerDebtOrder[]
}

export type DebtsReport = ReturnType<typeof reportHeader> & {
  asOf: string | null
  asOfAt: string | null
  customersAsOf: 'current'
  suppliers: { items: SupplierDebtItem[]; totalBani: number }
  managers: { items: ManagerDebtItem[]; totalBani: number }
  customers: { items: CustomerDebtItem[]; totalBani: number; pagination: ReturnType<typeof pagination> }
}

type NamedDoc = { _id: ObjectIdLike; name?: string }

const total = <T>(items: T[], pick: (item: T) => number) => items.reduce((sum, item) => sum + pick(item), 0)

/** Більший борг вище, далі id (детерміновано). */
const byAmountThenId = <T>(amount: (item: T) => number, id: (item: T) => string | null) => (a: T, b: T) =>
  amount(b) - amount(a) || String(id(a) ?? '').localeCompare(String(id(b) ?? ''))

export const getDebtsReport = async (
  req: PayloadRequest,
  { asOf, includeZero }: DebtsFilters,
  paging: Paging,
): Promise<DebtsReport> => {
  const session = await readSession(req)
  const keep = (amount: number) => includeZero || amount !== 0

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const supplierDebts = (await listSupplierDebts(req, asOf.at)).filter((debt) => keep(debt.debtBani))
  const managerDebts = (await listManagerDebts(req, asOf.at)).filter((debt) => keep(debt.debtBani))
  // Сервіс C5 повертає лише замовлення з боргом > 0, тож `includeZero` на покупців не впливає.
  const orderDebts = await getCustomerDebts(req)

  const byCustomer = new Map<string | null, CustomerDebtItem>()
  for (const debt of orderDebts) {
    const item = byCustomer.get(debt.customer) ?? {
      customer: debt.customer,
      name: null,
      email: null,
      ordersCount: 0,
      owedToUsBani: 0,
      orders: [],
    }
    item.ordersCount += 1
    item.owedToUsBani += debt.debtBani
    item.orders.push({
      order: debt.orderId,
      number: debt.number,
      capBani: debt.capBani,
      paidBani: debt.paidBani,
      owedToUsBani: debt.debtBani,
    })
    byCustomer.set(debt.customer, item)
  }

  const customers = [...byCustomer.values()].sort(byAmountThenId((item) => item.owedToUsBani, (item) => item.customer))
  const skip = (paging.page - 1) * paging.limit
  const customerPage = customers.slice(skip, skip + paging.limit)

  const suppliers = await loadByIds<NamedDoc>(req, 'suppliers', supplierDebts.map((debt) => toObjectId(req, debt.supplier)), { name: 1 }, session)
  const users = await loadByIds<UserDoc>(
    req,
    'users',
    [
      ...managerDebts.map((debt) => toObjectId(req, debt.manager)),
      ...customerPage.flatMap((item) => (item.customer ? [toObjectId(req, item.customer)] : [])),
    ],
    USER_PROJECTION,
    session,
  )

  const supplierItems = supplierDebts
    .map(({ supplier, goodsBani, extraBani, openingBani, paidBani, debtBani }) => ({
      supplier,
      name: suppliers.get(supplier)?.name ?? null,
      goodsBani,
      extraBani,
      openingBani,
      paidBani,
      weOweBani: debtBani,
    }))
    .sort(byAmountThenId((item) => item.weOweBani, (item) => item.supplier))
  const managerItems = managerDebts
    .map(({ manager, accruedBani, paidBani, debtBani }) => ({
      manager,
      name: personName(users.get(manager)),
      accruedBani,
      paidBani,
      weOweBani: debtBani,
    }))
    .sort(byAmountThenId((item) => item.weOweBani, (item) => item.manager))
  const customerItems = customerPage.map((item) => {
    const user = item.customer ? users.get(item.customer) : undefined

    return {
      ...item,
      name: personName(user),
      email: user?.email ?? null,
      orders: [...item.orders].sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? '')) || a.order.localeCompare(b.order)),
    }
  })

  return {
    ...reportHeader(),
    asOf: asOf.day,
    asOfAt: isoOrNull(asOf.at),
    customersAsOf: 'current',
    suppliers: { items: supplierItems, totalBani: total(supplierItems, (item) => item.weOweBani) },
    managers: { items: managerItems, totalBani: total(managerItems, (item) => item.weOweBani) },
    customers: {
      items: customerItems,
      totalBani: total(customers, (item) => item.owedToUsBani),
      pagination: pagination(paging, customers.length),
    },
  }
}
