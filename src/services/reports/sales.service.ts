import type { PayloadRequest } from 'payload'

import {
  accountingWarnings,
  aggregate,
  collectionName,
  type ObjectIdLike,
  type Period,
  readSession,
  reportHeader,
  toObjectId,
} from './common'

/**
 * Продажі зі складу за період у штуках: рухи `sale` мінус `sale_cancel` цього складу з датою руху в
 * періоді, тобто скільки товару фактично пішло зі складу. Основа для поповнення складу переміщенням.
 * Товари з нульовим або від'ємним підсумком (усе повернуто) не показуються. Порядок: назва, id товару.
 */

export type SalesRow = {
  product: { id: string; title: string | null; article: string | null }
  soldQty: number
}

export type SalesReport = ReturnType<typeof reportHeader> & {
  warehouse: string
  items: SalesRow[]
  totals: { soldQty: number; count: number }
  warnings: Awaited<ReturnType<typeof accountingWarnings>>
}

type AggregateRow = { _id: ObjectIdLike; qty: number; productDoc?: { title?: string; article?: string } }

export const salesFromWarehouse = (warehouse: ObjectIdLike, { start, end }: Pick<Period, 'start' | 'end'>) => ({
  warehouse,
  moveType: { $in: ['sale', 'sale_cancel'] },
  date: { $gte: start, $lte: end },
})

export const getSalesReport = async (req: PayloadRequest, period: Period, warehouse: string): Promise<SalesReport> => {
  const session = await readSession(req)

  const rows = await aggregate<AggregateRow>(
    req,
    'stock-moves',
    [
      { $match: salesFromWarehouse(toObjectId(req, warehouse), period) },
      // Продаж зменшує залишок (qtyDelta < 0), скасування повертає (> 0).
      { $group: { _id: '$product', qty: { $sum: { $multiply: ['$qtyDelta', -1] } } } },
      { $match: { qty: { $gt: 0 } } },
      {
        $lookup: {
          from: collectionName(req, 'products'),
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { title: 1, article: 1 } }],
          as: 'productDoc',
        },
      },
      { $unwind: { path: '$productDoc', preserveNullAndEmptyArrays: true } },
      { $sort: { 'productDoc.title': 1, _id: 1 } },
    ],
    session,
  )
  const warnings = await accountingWarnings(req, period.start)

  const items = rows.map((row) => ({
    product: { id: String(row._id), title: row.productDoc?.title ?? null, article: row.productDoc?.article ?? null },
    soldQty: row.qty,
  }))

  return {
    ...reportHeader(period),
    warehouse,
    items,
    totals: { soldQty: items.reduce((sum, item) => sum + item.soldQty, 0), count: items.length },
    warnings,
  }
}

/**
 * Чернетка переміщення `source → warehouse` з позиціями й кількостями звіту продажів (нічого не
 * проводиться). Рядки рахуються на сервері заново, тож документ відповідає звіту на момент створення.
 * `null`, якщо за період нічого не продано.
 */
export const createRestockTransfer = async (
  req: PayloadRequest,
  period: Period,
  warehouse: string,
  source: string,
): Promise<{ id: string; number: string | null; lines: number } | null> => {
  const { items } = await getSalesReport(req, period, warehouse)
  if (items.length === 0) return null

  const doc = await req.payload.create({
    collection: 'stock-transfers',
    data: {
      status: 'draft',
      documentDate: new Date().toISOString(),
      fromWarehouse: source,
      toWarehouse: warehouse,
      lines: items.map((item) => ({ product: item.product.id, quantity: item.soldQty })),
    },
    depth: 0,
    overrideAccess: false,
    user: req.user,
    req,
  })

  return { id: String(doc.id), number: doc.number ?? null, lines: items.length }
}
