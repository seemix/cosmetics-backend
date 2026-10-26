import type { PayloadRequest } from 'payload'

import {
  accountingWarnings,
  aggregate,
  countedInPeriod,
  isoOrNull,
  loadByIds,
  type ObjectIdLike,
  type Paging,
  pagination,
  type Period,
  readSession,
  reportHeader,
  toObjectId,
} from './common'

/**
 * Закупівлі за період (розд. 12): накладні з `postedAt` у періоді, не сторновані на `end`.
 * Суми беруться з полів накладної (`goodsTotalBani`, `extraTotalBani`, `landedTotalBani`), не перераховуються.
 */

export type PurchaseSums = { goodsTotalBani: number; extraTotalBani: number; landedTotalBani: number; count: number }

type Ref = { id: string; name: string | null } | null

export type PurchaseItem = {
  id: string
  number: string | null
  status: string
  supplier: Ref
  supplierInvoiceNo: string | null
  warehouse: (Ref & { code?: string | null }) | null
  postedAt: string | null
  reversedAt: string | null
  goodsTotalBani: number
  extraTotalBani: number
  landedTotalBani: number
}

export type PurchasesReport = ReturnType<typeof reportHeader> & {
  totals: PurchaseSums
  bySupplier: Array<{ supplier: string | null; name: string | null } & PurchaseSums>
  items: PurchaseItem[]
  pagination: ReturnType<typeof pagination>
  warnings: Awaited<ReturnType<typeof accountingWarnings>>
}

type SumsRow = { _id: ObjectIdLike | null } & PurchaseSums
type PurchaseRow = {
  _id: ObjectIdLike
  number?: string
  status: string
  supplier?: ObjectIdLike | null
  supplierInvoiceNo?: string | null
  warehouse?: ObjectIdLike | null
  postedAt?: Date
  reversedAt?: Date | null
  goodsTotalBani?: number
  extraTotalBani?: number
  landedTotalBani?: number
}
type FacetRow = { totals: SumsRow[]; bySupplier: SumsRow[]; items: PurchaseRow[] }
type NamedDoc = { _id: ObjectIdLike; name?: string; code?: string }

const SUMS = {
  goodsTotalBani: { $sum: { $ifNull: ['$goodsTotalBani', 0] } },
  extraTotalBani: { $sum: { $ifNull: ['$extraTotalBani', 0] } },
  landedTotalBani: { $sum: { $ifNull: ['$landedTotalBani', 0] } },
  count: { $sum: 1 },
}

const sumsOf = (row: SumsRow | undefined): PurchaseSums => ({
  goodsTotalBani: row?.goodsTotalBani ?? 0,
  extraTotalBani: row?.extraTotalBani ?? 0,
  landedTotalBani: row?.landedTotalBani ?? 0,
  count: row?.count ?? 0,
})

export const getPurchasesReport = async (
  req: PayloadRequest,
  period: Period,
  { supplier }: { supplier?: string },
  paging: Paging,
): Promise<PurchasesReport> => {
  const session = await readSession(req)
  const match = { ...countedInPeriod('postedAt', period), ...(supplier ? { supplier: toObjectId(req, supplier) } : {}) }

  const [facet] = await aggregate<FacetRow>(
    req,
    'purchases',
    [
      { $match: match },
      {
        $facet: {
          totals: [{ $group: { _id: null, ...SUMS } }],
          bySupplier: [{ $group: { _id: '$supplier', ...SUMS } }],
          items: [
            { $sort: { postedAt: -1, _id: -1 } },
            { $skip: (paging.page - 1) * paging.limit },
            { $limit: paging.limit },
            {
              $project: {
                number: 1,
                status: 1,
                supplier: 1,
                supplierInvoiceNo: 1,
                warehouse: 1,
                postedAt: 1,
                reversedAt: 1,
                goodsTotalBani: 1,
                extraTotalBani: 1,
                landedTotalBani: 1,
              },
            },
          ],
        },
      },
    ],
    session,
  )

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const suppliers = await loadByIds<NamedDoc>(
    req,
    'suppliers',
    [...facet.bySupplier.map((row) => row._id), ...facet.items.map((row) => row.supplier)],
    { name: 1 },
    session,
  )
  const warehouses = await loadByIds<NamedDoc>(req, 'warehouses', facet.items.map((row) => row.warehouse), { name: 1, code: 1 }, session)
  const warnings = await accountingWarnings(req, period.start)

  const totals = sumsOf(facet.totals[0])
  const bySupplier = facet.bySupplier
    .map((row) => ({
      supplier: row._id ? String(row._id) : null,
      name: row._id ? (suppliers.get(String(row._id))?.name ?? null) : null,
      ...sumsOf(row),
    }))
    .sort((a, b) => b.landedTotalBani - a.landedTotalBani || String(a.supplier).localeCompare(String(b.supplier)))

  const items = facet.items.map((row): PurchaseItem => {
    const warehouse = row.warehouse ? warehouses.get(String(row.warehouse)) : undefined

    return {
      id: String(row._id),
      number: row.number ?? null,
      status: row.status,
      supplier: row.supplier ? { id: String(row.supplier), name: suppliers.get(String(row.supplier))?.name ?? null } : null,
      supplierInvoiceNo: row.supplierInvoiceNo ?? null,
      warehouse: row.warehouse ? { id: String(row.warehouse), name: warehouse?.name ?? null, code: warehouse?.code ?? null } : null,
      postedAt: isoOrNull(row.postedAt),
      reversedAt: isoOrNull(row.reversedAt),
      goodsTotalBani: row.goodsTotalBani ?? 0,
      extraTotalBani: row.extraTotalBani ?? 0,
      landedTotalBani: row.landedTotalBani ?? 0,
    }
  })

  return {
    ...reportHeader(period),
    totals,
    bySupplier,
    items,
    pagination: pagination(paging, totals.count),
    warnings,
  }
}
