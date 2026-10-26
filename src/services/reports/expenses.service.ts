import type { PayloadRequest } from 'payload'

import {
  accountingWarnings,
  aggregate,
  idOrNull,
  isoOrNull,
  loadByIds,
  type ObjectIdLike,
  type Paging,
  pagination,
  type Period,
  personName,
  readSession,
  reportHeader,
  toObjectId,
  USER_PROJECTION,
  type UserDoc,
} from './common'
import { byTotalThenCode, type ExpenseCategoryTotal, expensesInPeriod, loadCategories, toCategoryTotal } from './profit.service'

/**
 * Витрати за період (розд. 12): та сама вибірка, що й у прибутку (касовий метод, сторно «на дату»),
 * з розбивкою по статтях і касах та списком операцій.
 */

export type ExpensesFilters = { category?: string; account?: string }

type Ref = { id: string; name: string | null } | null

export type ExpenseItem = {
  id: string
  number: string | null
  operationDate: string | null
  category: { id: string; code: string | null; name: string | null } | null
  account: Ref
  amountBani: number
  supplier: Ref
  manager: Ref
}

export type ExpensesReport = ReturnType<typeof reportHeader> & {
  totalBani: number
  count: number
  byCategory: ExpenseCategoryTotal[]
  byAccount: Array<{ account: string | null; code: string | null; name: string | null; totalBani: number; count: number }>
  items: ExpenseItem[]
  pagination: ReturnType<typeof pagination>
  warnings: Awaited<ReturnType<typeof accountingWarnings>>
}

type GroupRow = { _id: ObjectIdLike | null; totalBani: number; count: number }
type OperationRow = {
  _id: ObjectIdLike
  number?: string
  operationDate?: Date
  category?: ObjectIdLike | null
  account?: ObjectIdLike | null
  amountBani: number
  supplier?: ObjectIdLike | null
  manager?: ObjectIdLike | null
}
type FacetRow = { byCategory: GroupRow[]; byAccount: GroupRow[]; items: OperationRow[]; count: Array<{ n: number }> }
type NamedDoc = { _id: ObjectIdLike; name?: string; code?: string }

export const getExpensesReport = async (
  req: PayloadRequest,
  period: Period,
  { category, account }: ExpensesFilters,
  paging: Paging,
): Promise<ExpensesReport> => {
  const session = await readSession(req)
  const match = {
    ...expensesInPeriod(period),
    ...(category ? { category: toObjectId(req, category) } : {}),
    ...(account ? { account: toObjectId(req, account) } : {}),
  }
  const group = (field: string) => [{ $group: { _id: `$${field}`, totalBani: { $sum: '$amountBani' }, count: { $sum: 1 } } }]

  const [facet] = await aggregate<FacetRow>(
    req,
    'cash-operations',
    [
      { $match: match },
      {
        $facet: {
          byCategory: group('category'),
          byAccount: group('account'),
          items: [
            { $sort: { operationDate: -1, _id: -1 } },
            { $skip: (paging.page - 1) * paging.limit },
            { $limit: paging.limit },
            { $project: { number: 1, operationDate: 1, category: 1, account: 1, amountBani: 1, supplier: 1, manager: 1 } },
          ],
          count: [{ $count: 'n' }],
        },
      },
    ],
    session,
  )

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const categories = await loadCategories(
    req,
    [...facet.byCategory.map((row) => row._id), ...facet.items.map((row) => row.category ?? null)],
    session,
  )
  const accounts = await loadByIds<NamedDoc>(
    req,
    'cash-accounts',
    [...facet.byAccount.map((row) => row._id), ...facet.items.map((row) => row.account)],
    { name: 1, code: 1 },
    session,
  )
  const suppliers = await loadByIds<NamedDoc>(req, 'suppliers', facet.items.map((row) => row.supplier), { name: 1 }, session)
  const managers = await loadByIds<UserDoc>(req, 'users', facet.items.map((row) => row.manager), USER_PROJECTION, session)
  const warnings = await accountingWarnings(req, period.start)

  const byCategory = facet.byCategory.map((row) => toCategoryTotal(row, categories)).sort(byTotalThenCode)
  const byAccount = facet.byAccount
    .map((row) => {
      const id = idOrNull(row._id)
      const doc = id ? accounts.get(id) : undefined
      return { account: id, code: doc?.code ?? null, name: doc?.name ?? null, totalBani: row.totalBani, count: row.count }
    })
    .sort((a, b) => b.totalBani - a.totalBani || String(a.code ?? '').localeCompare(String(b.code ?? '')))
  const count = facet.count[0]?.n ?? 0

  const named = (map: Map<string, NamedDoc>, id: ObjectIdLike | null | undefined): Ref =>
    id ? { id: String(id), name: map.get(String(id))?.name ?? null } : null

  const items = facet.items.map((row): ExpenseItem => {
    const categoryDoc = row.category ? categories.get(String(row.category)) : undefined

    return {
      id: String(row._id),
      number: row.number ?? null,
      operationDate: isoOrNull(row.operationDate),
      category: row.category
        ? { id: String(row.category), code: categoryDoc?.code ?? null, name: categoryDoc?.name ?? null }
        : null,
      account: named(accounts, row.account),
      amountBani: row.amountBani,
      supplier: named(suppliers, row.supplier),
      manager: row.manager ? { id: String(row.manager), name: personName(managers.get(String(row.manager))) } : null,
    }
  })

  return {
    ...reportHeader(period),
    totalBani: byCategory.reduce((sum, row) => sum + row.totalBani, 0),
    count,
    byCategory,
    byAccount,
    items,
    pagination: pagination(paging, count),
    warnings,
  }
}
