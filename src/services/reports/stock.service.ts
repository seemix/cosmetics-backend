import type { PayloadRequest } from 'payload'

import { allocateLargestRemainder } from '@/utilities/money'

import {
  collectionName,
  loadByIds,
  model,
  type ObjectIdLike,
  type Paging,
  pagination,
  readSession,
  reportHeader,
  toObjectId,
} from './common'
import { escapeRegExp } from './params'

/**
 * Залишки й вартість по товарах (розд. 12) з кешу: `product-costs` (вартість на товар) і
 * `stock-balances` (кількість товар × склад). Вартість складу = частка `product-costs.valueBani`
 * за кількістю методом найбільших залишків, тож Σ складів = вартість товару точно.
 * Один прохід курсором у детермінованому порядку (назва, id товару): totals за всіма сторінками,
 * у пам'яті лише поточна сторінка.
 */

export type StockFilters = { warehouse?: string; q?: string; onlyPositive: boolean }

export type StockRow = {
  product: { id: string; title: string | null; article: string | null }
  qtyByWarehouse: Array<{ warehouse: string; code: string | null; qty: number; valueBani: number }>
  totalQty: number
  valueBani: number
  /** `valueBani / totalQty`, округлено до бана; лише для показу. */
  avgCostBani: number
}

export type StockReport = ReturnType<typeof reportHeader> & {
  items: StockRow[]
  totals: { totalQty: number; totalValueBani: number; count: number }
  pagination: ReturnType<typeof pagination>
}

type CursorRow = {
  product: ObjectIdLike
  valueBani?: number
  productDoc: { title?: string; article?: string }
  balances: Array<{ warehouse: ObjectIdLike; qty: number }>
}

/** Кількість по складах товару (кілька документів одного складу, напр. варіанти, сумуються); порядок за id складу. */
const byWarehouse = (balances: CursorRow['balances']) => {
  const map = new Map<string, number>()
  for (const balance of balances) {
    const id = String(balance.warehouse)
    map.set(id, (map.get(id) ?? 0) + (balance.qty ?? 0))
  }

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([warehouse, qty]) => ({ warehouse, qty }))
}

/** Розподіл вартості товару по складах; без складів (неузгоджений кеш) нічого розподіляти. */
const allocate = (valueBani: number, warehouses: Array<{ warehouse: string; qty: number }>) => {
  if (warehouses.length === 0) return []
  const shares = allocateLargestRemainder(valueBani, warehouses.map((item) => item.qty))

  return warehouses.map((item, index) => ({ ...item, valueBani: shares[index] }))
}

const average = (valueBani: number, qty: number) => (qty > 0 ? Math.round(valueBani / qty) : 0)

export const getStockReport = async (
  req: PayloadRequest,
  { warehouse, q, onlyPositive }: StockFilters,
  paging: Paging,
): Promise<StockReport> => {
  const session = await readSession(req)
  const warehouseId = warehouse ? toObjectId(req, warehouse) : undefined
  const pattern = q ? { $regex: escapeRegExp(q), $options: 'i' } : undefined

  const pipeline = [
    // Кеш вартості: один документ на товар (індекс `product`); без складу фільтр за загальною кількістю.
    { $match: onlyPositive && !warehouseId ? { qty: { $gt: 0 } } : {} },
    {
      $lookup: {
        from: collectionName(req, 'products'),
        localField: 'product',
        foreignField: '_id',
        pipeline: [{ $project: { title: 1, article: 1 } }],
        as: 'productDoc',
      },
    },
    { $unwind: '$productDoc' },
    ...(pattern ? [{ $match: { $or: [{ 'productDoc.title': pattern }, { 'productDoc.article': pattern }] } }] : []),
    {
      $lookup: {
        from: collectionName(req, 'stock-balances'),
        localField: 'product',
        foreignField: 'product',
        pipeline: [{ $project: { warehouse: 1, qty: 1 } }],
        as: 'balances',
      },
    },
    ...(warehouseId && onlyPositive ? [{ $match: { balances: { $elemMatch: { warehouse: warehouseId, qty: { $gt: 0 } } } } }] : []),
    { $sort: { 'productDoc.title': 1, product: 1 } },
    { $project: { product: 1, valueBani: 1, productDoc: 1, balances: 1 } },
  ]

  const cursor = model(req, 'product-costs')
    .aggregate<CursorRow>(pipeline as never)
    .session(session ?? null)
    .cursor({ batchSize: 200 })

  const skip = (paging.page - 1) * paging.limit
  const pageRows: Array<Omit<StockRow, 'qtyByWarehouse'> & { qtyByWarehouse: Array<{ warehouse: string; qty: number; valueBani: number }> }> = []
  const totals = { totalQty: 0, totalValueBani: 0, count: 0 }

  for await (const row of cursor) {
    const all = allocate(row.valueBani ?? 0, byWarehouse(row.balances))
    // Склади з нульовою кількістю не показуються (їх частка вартості теж 0).
    const shown = all.filter((item) => (warehouse ? item.warehouse === warehouse : item.qty !== 0))
    const totalQty = shown.reduce((sum, item) => sum + item.qty, 0)
    // Без фільтра складу вартість рядка — уся вартість товару (навіть якщо кеш складів неузгоджений).
    const valueBani = warehouse ? shown.reduce((sum, item) => sum + item.valueBani, 0) : (row.valueBani ?? 0)

    if (totals.count >= skip && pageRows.length < paging.limit) {
      pageRows.push({
        product: { id: String(row.product), title: row.productDoc.title ?? null, article: row.productDoc.article ?? null },
        qtyByWarehouse: shown,
        totalQty,
        valueBani,
        avgCostBani: average(valueBani, totalQty),
      })
    }

    totals.count += 1
    totals.totalQty += totalQty
    totals.totalValueBani += valueBani
  }

  const warehouses = await loadByIds<{ _id: ObjectIdLike; code?: string }>(
    req,
    'warehouses',
    pageRows.flatMap((row) => row.qtyByWarehouse.map((item) => toObjectId(req, item.warehouse))),
    { code: 1 },
    session,
  )

  return {
    ...reportHeader(),
    items: pageRows.map((row) => ({
      ...row,
      qtyByWarehouse: row.qtyByWarehouse.map((item) => ({
        warehouse: item.warehouse,
        code: warehouses.get(item.warehouse)?.code ?? null,
        qty: item.qty,
        valueBani: item.valueBani,
      })),
    })),
    totals,
    pagination: pagination(paging, totals.count),
  }
}
