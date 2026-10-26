import type { PayloadRequest } from 'payload'

import {
  accountingWarnings,
  aggregate,
  countedInPeriod,
  loadByIds,
  type ObjectIdLike,
  type Period,
  readSession,
  type ReadSession,
  reportHeader,
} from './common'

/**
 * Прибуток за період (docs/accounting/design.md, розд. 12; П8): виручка й собівартість за датою
 * списання замовлення, втрати складу за датою руху, витрати касовим методом.
 * Прибуток = виручка − собівартість − втрати складу − витрати.
 */

export type ExpenseCategoryTotal = {
  category: string | null
  code: string | null
  name: string | null
  isSalary: boolean
  totalBani: number
  count: number
}

export type ProfitReport = ReturnType<typeof reportHeader> & {
  revenueBani: number
  cogsBani: number
  grossProfitBani: number
  warehouseLossesBani: number
  expensesBani: number
  expensesByCategory: ExpenseCategoryTotal[]
  salaryExpensesBani: number
  profitBani: number
  ordersCount: number
  method: { revenue: 'by_order_date'; expenses: 'cash' }
  warnings: Awaited<ReturnType<typeof accountingWarnings>>
}

type SalesRow = { revenueBani: number; cogsBani: number; ordersCount: number }
type SumRow = { total: number }
type CategoryRow = { _id: ObjectIdLike | null; totalBani: number; count: number }
type CategoryDoc = { _id: ObjectIdLike; code?: string; name?: string; isSalary?: boolean }

/**
 * Замовлення, що дають виручку періоду: склад списано в періоді й на `end` не скасоване
 * (`accounting.cancelledAt` порожній або пізніше `end`). Історичні (без `stockPostedAt`) не входять.
 */
export const salesInPeriod = ({ start, end }: Pick<Period, 'start' | 'end'>) => ({
  'accounting.stockPostedAt': { $gte: start, $lte: end },
  $or: [{ 'accounting.cancelledAt': null }, { 'accounting.cancelledAt': { $gt: end } }],
})

/**
 * Рухи документів `stock-adjustments` (списання, інвентаризація і їх сторно) за датою руху.
 * Надлишок інвентаризації дає додатну зміну вартості й зменшує втрати.
 */
export const warehouseLossesInPeriod = ({ start, end }: Pick<Period, 'start' | 'end'>) => ({
  docCollection: 'stock-adjustments',
  date: { $gte: start, $lte: end },
})

/** Витрати періоду: `expense`, проведені (або сторновані після `end`), за `operationDate`. */
export const expensesInPeriod = (period: Pick<Period, 'start' | 'end'>) => ({
  type: 'expense',
  ...countedInPeriod('operationDate', period),
})

/** Статті витрат за id одним запитом; невідома стаття дає `null`-поля. */
export const loadCategories = (req: PayloadRequest, ids: Array<ObjectIdLike | null>, session: ReadSession) =>
  loadByIds<CategoryDoc>(req, 'expense-categories', ids, { code: 1, name: 1, isSalary: 1 }, session)

export const toCategoryTotal = (row: CategoryRow, categories: Map<string, CategoryDoc>): ExpenseCategoryTotal => {
  const id = row._id ? String(row._id) : null
  const doc = id ? categories.get(id) : undefined

  return {
    category: id,
    code: doc?.code ?? null,
    name: doc?.name ?? null,
    isSalary: doc?.isSalary === true,
    totalBani: row.totalBani,
    count: row.count,
  }
}

/** Сортування статей: більша сума вище, далі код (детерміновано). */
export const byTotalThenCode = (a: ExpenseCategoryTotal, b: ExpenseCategoryTotal) =>
  b.totalBani - a.totalBani || String(a.code ?? '').localeCompare(String(b.code ?? ''))

export const getProfitReport = async (req: PayloadRequest, period: Period): Promise<ProfitReport> => {
  const session = await readSession(req)

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const [sales] = await aggregate<SalesRow>(
    req,
    'orders',
    [
      { $match: salesInPeriod(period) },
      {
        $group: {
          _id: null,
          revenueBani: { $sum: { $ifNull: ['$accounting.revenueBani', 0] } },
          cogsBani: { $sum: { $ifNull: ['$accounting.cogsBani', 0] } },
          ordersCount: { $sum: 1 },
        },
      },
    ],
    session,
  )
  const [adjustments] = await aggregate<SumRow>(
    req,
    'stock-moves',
    [{ $match: warehouseLossesInPeriod(period) }, { $group: { _id: null, total: { $sum: '$valueDeltaBani' } } }],
    session,
  )
  const categoryRows = await aggregate<CategoryRow>(
    req,
    'cash-operations',
    [
      { $match: expensesInPeriod(period) },
      { $group: { _id: '$category', totalBani: { $sum: '$amountBani' }, count: { $sum: 1 } } },
    ],
    session,
  )
  const categories = await loadCategories(
    req,
    categoryRows.map((row) => row._id),
    session,
  )
  const warnings = await accountingWarnings(req, period.start)

  const expensesByCategory = categoryRows.map((row) => toCategoryTotal(row, categories)).sort(byTotalThenCode)
  const revenueBani = sales?.revenueBani ?? 0
  const cogsBani = sales?.cogsBani ?? 0
  // `|| 0` прибирає −0, коли рухів немає або вони взаємно знулились.
  const warehouseLossesBani = -(adjustments?.total ?? 0) || 0
  const expensesBani = expensesByCategory.reduce((sum, row) => sum + row.totalBani, 0)
  const salaryExpensesBani = expensesByCategory.filter((row) => row.isSalary).reduce((sum, row) => sum + row.totalBani, 0)

  return {
    ...reportHeader(period),
    revenueBani,
    cogsBani,
    grossProfitBani: revenueBani - cogsBani,
    warehouseLossesBani,
    expensesBani,
    expensesByCategory,
    salaryExpensesBani,
    profitBani: revenueBani - cogsBani - warehouseLossesBani - expensesBani,
    ordersCount: sales?.ordersCount ?? 0,
    method: { revenue: 'by_order_date', expenses: 'cash' },
    warnings,
  }
}
