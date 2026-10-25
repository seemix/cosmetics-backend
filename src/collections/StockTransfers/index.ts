import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { validateInteger } from '@/collections/Stock/shared'
import { collectionLabels, customT, label, localized } from '@/i18n'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { revert, transfer } from '@/services/stock/stockLedger.service'

type Relation = string | { id: string }
type LineData = { product: Relation; quantity: number }

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'stock-transfers',
  id,
  number: String(data.number ?? originalDoc.number),
})

/** Проведення: умовно зі складу-джерела, на склад-приймач; `product-costs` не змінюється (розд. 3.2). */
const postTransfer = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.lines ?? originalDoc.lines ?? []) as LineData[]

  await transfer(req, {
    doc: docRef(args),
    date,
    from: idOf((data.fromWarehouse ?? originalDoc.fromWarehouse) as Relation),
    to: idOf((data.toWarehouse ?? originalDoc.toWarehouse) as Relation),
    lines: lines.map((line) => ({ product: idOf(line.product), qty: line.quantity })),
  })
}

/** Сторно дзеркальне: умовно з приймача, назад на джерело. */
const reverseTransfer = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'stock-transfers' },
      docId: { equals: id },
      moveType: { in: ['transfer_out', 'transfer_in'] },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}

const lifecycle = documentLifecycle({
  prefix: 'TRF',
  counterKey: 'transferNumber',
  onPost: postTransfer,
  onReverse: reverseTransfer,
})

/** Склади різні, рядки непорожні: перевіряється у чернетці й ще раз при проведенні. */
const validateTransfer: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const from = data.fromWarehouse ?? originalDoc?.fromWarehouse
  const to = data.toWarehouse ?? originalDoc?.toWarehouse

  if (from && to && String(idOf(from)) === String(idOf(to))) {
    throw new APIError(customT(req.t)('custom:error:transferSameWarehouse'), 400, undefined, true)
  }

  return data
}

/** Переміщення між складами, див. docs/accounting/design.md, розд. 2.2, 3.2. */
export const StockTransfers: CollectionConfig = {
  slug: 'stock-transfers',
  labels: collectionLabels('custom:collection:stockTransfers:singular', 'custom:collection:stockTransfers:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'fromWarehouse', 'toWarehouse', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:stock'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    beforeChange: [validateTransfer, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      type: 'row',
      fields: [
        {
          name: 'fromWarehouse',
          label: label('custom:field:fromWarehouse'),
          type: 'relationship',
          relationTo: 'warehouses',
          required: true,
          filterOptions: { isActive: { equals: true } },
        },
        {
          name: 'toWarehouse',
          label: label('custom:field:toWarehouse'),
          type: 'relationship',
          relationTo: 'warehouses',
          required: true,
          filterOptions: { isActive: { equals: true } },
        },
      ],
    },
    {
      name: 'lines',
      label: label('custom:field:lines'),
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
            { name: 'quantity', label: label('custom:term:quantity'), type: 'number', required: true, min: 1, validate: validateInteger },
          ],
        },
      ],
    },
  ],
}
