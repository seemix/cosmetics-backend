import type { Endpoint, PayloadRequest } from 'payload'

import { checkRole } from '@/access/utilities'

export type ProductStock = {
  productId: string
  warehouses: Array<{ id: string; name: string; code: string; qty: number }>
  /** Σ залишків по складах. */
  totalQty: number
  /** Вартість усього залишку (бані) і середня за штуку (бані, дробове), з `product-costs`. */
  valueBani: number
  avgCostBani: number
  lastPurchaseUnitCostBani: number | null
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/

/**
 * Залишки товару по складах і середня собівартість для картки товару в адмінці.
 * Роль перевіряється явно (D7). Поки немає ролі manager (M1, залежить від В11),
 * доступ лише в admin: собівартість менеджерам не віддаємо.
 */
export const getProductStock: Endpoint = {
  path: '/stock/product/:id',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    if (!req.user) return Response.json({ message: 'Unauthorized' }, { status: 401 })
    if (!checkRole(['admin'], req.user)) return Response.json({ message: 'Forbidden' }, { status: 403 })

    const id = req.routeParams?.id as string | undefined
    if (!id || !OBJECT_ID.test(id)) return Response.json({ message: 'Invalid product id' }, { status: 400 })

    const product = await req.payload.findByID({
      collection: 'products',
      id,
      depth: 0,
      disableErrors: true,
      select: { article: true },
      req,
    })
    if (!product) return Response.json({ message: 'Product not found' }, { status: 404 })

    const [balances, costs] = await Promise.all([
      req.payload.find({
        collection: 'stock-balances',
        where: { product: { equals: id } },
        pagination: false,
        depth: 1,
        select: { warehouse: true, qty: true },
        populate: { warehouses: { name: true, code: true, sortOrder: true } },
        req,
      }),
      req.payload.find({
        collection: 'product-costs',
        where: { product: { equals: id } },
        limit: 1,
        depth: 0,
        req,
      }),
    ])

    const warehouses = balances.docs
      .map((balance) => {
        const warehouse = typeof balance.warehouse === 'object' ? balance.warehouse : null

        return {
          id: String(warehouse?.id ?? balance.warehouse),
          name: warehouse?.name ?? '',
          code: warehouse?.code ?? '',
          qty: balance.qty,
          sortOrder: warehouse?.sortOrder ?? 0,
        }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(({ sortOrder: _sortOrder, ...warehouse }) => warehouse)

    const cost = costs.docs[0]
    const body: ProductStock = {
      productId: id,
      warehouses,
      totalQty: warehouses.reduce((sum, warehouse) => sum + warehouse.qty, 0),
      valueBani: cost?.valueBani ?? 0,
      avgCostBani: cost && cost.qty > 0 ? cost.valueBani / cost.qty : 0,
      lastPurchaseUnitCostBani: cost?.lastPurchaseUnitCostBani ?? null,
    }

    return Response.json(body)
  },
}
