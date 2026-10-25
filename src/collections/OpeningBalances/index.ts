import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { validateInteger } from '@/collections/Stock/shared'
import { moneyField } from '@/fields/money'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { receive, revert } from '@/services/stock/stockLedger.service'

type Relation = string | { id: string }
type StockLine = { warehouse: Relation; product: Relation; quantity: number; unitCostBani: number }

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const fail = (message: string): never => {
  throw new APIError(message, 400, undefined, true)
}

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'opening-balances',
  id,
  number: String(data.number ?? originalDoc.number),
})

/** Проведення kind=stock як прихід: вартість рядка `quantity × unitCostBani`, рух `opening` (розд. 3.2). */
const postOpening = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.stockLines ?? originalDoc.stockLines ?? []) as StockLine[]

  if (lines.length === 0) fail('An opening balance without lines cannot be posted')

  await receive(req, {
    doc: docRef(args),
    date,
    moveType: 'opening',
    lines: lines.map((line) => ({
      product: idOf(line.product),
      warehouse: idOf(line.warehouse),
      qty: line.quantity,
      valueBani: line.quantity * line.unitCostBani,
    })),
  })
}

/** Сторно як сторно приходу: умовне списання, `qty = 0 ⇒ value = 0`, блок при `value < 0`. */
const reverseOpening = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'opening-balances' },
      docId: { equals: id },
      moveType: { equals: 'opening' },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}

const lifecycle = documentLifecycle({
  prefix: 'OPN',
  counterKey: 'openingNumber',
  onPost: postOpening,
  onReverse: reverseOpening,
})

/** Один рядок на пару товар × склад: дубль подвоїв би залишок. */
const validateOpening: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const lines = (data.stockLines ?? originalDoc?.stockLines ?? []) as StockLine[]
  const keys = lines.map((line) => `${idOf(line.product)}:${idOf(line.warehouse)}`)

  if (new Set(keys).size !== keys.length) fail('A product can appear only once per warehouse')

  return data
}

/** Початкові залишки, див. docs/accounting/design.md, розд. 2.2, 10. Kinds cash/supplierDebt/customerDebt додаються в C1/C5. */
export const OpeningBalances: CollectionConfig = {
  slug: 'opening-balances',
  labels: { singular: 'Opening balance', plural: 'Opening balances' },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'kind', 'postedAt'],
    listSearchableFields: ['number'],
    group: 'Stock',
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    beforeChange: [validateOpening, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'kind',
      label: 'Kind',
      type: 'select',
      required: true,
      defaultValue: 'stock',
      options: [{ label: 'Stock', value: 'stock' }],
    },
    {
      name: 'stockLines',
      label: 'Stock lines',
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'stock' },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'warehouse',
              label: 'Warehouse',
              type: 'relationship',
              relationTo: 'warehouses',
              required: true,
              filterOptions: { isActive: { equals: true } },
            },
            { name: 'product', label: 'Product', type: 'relationship', relationTo: 'products', required: true },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, validate: validateInteger },
            moneyField({ name: 'unitCostBani', label: 'Unit cost', required: true, min: 1 }),
          ],
        },
      ],
    },
  ],
}
