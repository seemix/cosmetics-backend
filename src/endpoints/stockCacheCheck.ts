import type { Endpoint, PayloadRequest } from 'payload'

import { checkRole } from '@/access/utilities'
import { runInTransaction } from '@/services/documents/documentLifecycle'
import { requireSession } from '@/services/stock/session'

/**
 * Перевірка й перебудова кешу залишків з журналу `stock-moves` (docs/accounting/design.md, розд. 4.4).
 * Журнал джерело правди: `stock-balances` має дорівнювати Σ qtyDelta за {product, warehouse},
 * `product-costs` Σ qtyDelta і Σ valueDeltaBani за product. Запускати в неробочий час:
 * проведення, що йдуть паралельно, дають розбіжності, яких насправді немає.
 */

export type BalanceDiscrepancy = {
  type: 'balance'
  product: string
  warehouse: string
  expectedQty: number
  /** `null`, якщо документа кешу немає. */
  actualQty: number | null
}

export type CostDiscrepancy = {
  type: 'cost'
  product: string
  expectedQty: number
  expectedValueBani: number
  actualQty: number | null
  actualValueBani: number | null
}

export type StockCacheDiscrepancy = BalanceDiscrepancy | CostDiscrepancy

type ObjectIdLike = { toString(): string }
type BalanceRow = { _id: { product: ObjectIdLike; warehouse: ObjectIdLike }; qty: number }
type CostRow = { _id: ObjectIdLike; qty: number; valueBani: number }

type Session = Awaited<ReturnType<typeof requireSession>>

const aggregateJournal = async (req: PayloadRequest, session?: Session) => {
  const moves = req.payload.db.collections['stock-moves']

  const byBalance = moves
    .aggregate<BalanceRow>([
      { $group: { _id: { product: '$product', warehouse: '$warehouse' }, qty: { $sum: '$qtyDelta' } } },
    ])
    .session(session ?? null)
  const byProduct = moves
    .aggregate<CostRow>([
      { $group: { _id: '$product', qty: { $sum: '$qtyDelta' }, valueBani: { $sum: '$valueDeltaBani' } } },
    ])
    .session(session ?? null)

  return { balances: await byBalance, costs: await byProduct }
}

const idOf = (value: unknown) =>
  String(typeof value === 'object' && value !== null && 'id' in value ? (value as { id: unknown }).id : value)

/** Порівнює кеш із журналом і повертає розбіжності (нічого не змінює). */
export const checkStockCache = async (req: PayloadRequest, session?: Session): Promise<StockCacheDiscrepancy[]> => {
  const journal = await aggregateJournal(req, session)
  const [balanceDocs, costDocs] = await Promise.all([
    req.payload.find({ collection: 'stock-balances', pagination: false, depth: 0, req }),
    req.payload.find({ collection: 'product-costs', pagination: false, depth: 0, req }),
  ])

  const discrepancies: StockCacheDiscrepancy[] = []

  const expectedBalances = new Map(
    journal.balances.map((row) => [`${row._id.product}:${row._id.warehouse}`, row.qty]),
  )
  const actualBalances = new Map(
    balanceDocs.docs.map((doc) => [`${idOf(doc.product)}:${idOf(doc.warehouse)}`, doc.qty]),
  )

  for (const key of new Set([...expectedBalances.keys(), ...actualBalances.keys()])) {
    const expectedQty = expectedBalances.get(key) ?? 0
    const actualQty = actualBalances.get(key) ?? null

    if (actualQty === expectedQty || (actualQty === null && expectedQty === 0)) continue

    const [product, warehouse] = key.split(':')
    discrepancies.push({ type: 'balance', product, warehouse, expectedQty, actualQty })
  }

  const expectedCosts = new Map(journal.costs.map((row) => [String(row._id), row]))
  const actualCosts = new Map(costDocs.docs.map((doc) => [idOf(doc.product), doc]))

  for (const product of new Set([...expectedCosts.keys(), ...actualCosts.keys()])) {
    const expected = expectedCosts.get(product)
    const actual = actualCosts.get(product)
    const expectedQty = expected?.qty ?? 0
    const expectedValueBani = expected?.valueBani ?? 0

    if (!actual && expectedQty === 0 && expectedValueBani === 0) continue
    if (actual && actual.qty === expectedQty && actual.valueBani === expectedValueBani) continue

    discrepancies.push({
      type: 'cost',
      product,
      expectedQty,
      expectedValueBani,
      actualQty: actual?.qty ?? null,
      actualValueBani: actual?.valueBani ?? null,
    })
  }

  return discrepancies
}

/**
 * Перебудовує кеш з журналу в одній транзакції: виправляє значення, створює відсутні документи
 * і обнуляє зайві. Повертає те, що було виправлено; `lastPurchaseUnitCostBani` не чіпає.
 */
export const fixStockCache = (req: PayloadRequest): Promise<StockCacheDiscrepancy[]> =>
  runInTransaction(req, async () => {
    const session = await requireSession(req)
    const discrepancies = await checkStockCache(req, session)

    for (const item of discrepancies) {
      if (item.type === 'balance') {
        const existing = await req.payload.find({
          collection: 'stock-balances',
          where: { product: { equals: item.product }, warehouse: { equals: item.warehouse } },
          limit: 1,
          depth: 0,
          req,
        })

        if (existing.docs[0]) {
          await req.payload.update({
            collection: 'stock-balances',
            id: existing.docs[0].id,
            data: { qty: item.expectedQty },
            depth: 0,
            req,
          })
        } else {
          await req.payload.create({
            collection: 'stock-balances',
            data: { product: item.product, warehouse: item.warehouse, qty: item.expectedQty },
            depth: 0,
            req,
          })
        }
        continue
      }

      const existing = await req.payload.find({
        collection: 'product-costs',
        where: { product: { equals: item.product } },
        limit: 1,
        depth: 0,
        req,
      })
      const data = { qty: item.expectedQty, valueBani: item.expectedValueBani }

      if (existing.docs[0]) {
        await req.payload.update({ collection: 'product-costs', id: existing.docs[0].id, data, depth: 0, req })
      } else {
        await req.payload.create({ collection: 'product-costs', data: { product: item.product, ...data }, depth: 0, req })
      }
    }

    return discrepancies
  })

/** D7: ендпоінт сам перевіряє роль, а не покладається на `overrideAccess`. */
const requireAdmin = (req: PayloadRequest): Response | null => {
  if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
  if (!checkRole(['admin'], req.user)) return Response.json({ message: 'Forbidden' }, { status: 403 })

  return null
}

export const stockCacheCheck: Endpoint = {
  path: '/stock/cache-check',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const discrepancies = await checkStockCache(req)

    return Response.json({ ok: discrepancies.length === 0, discrepancies })
  },
}

export const stockCacheRebuild: Endpoint = {
  path: '/stock/cache-rebuild',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const fixed = await fixStockCache(req)

    return Response.json({ ok: true, fixed })
  },
}
