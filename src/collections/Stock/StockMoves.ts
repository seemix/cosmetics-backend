import type { CollectionConfig } from 'payload'

import { validateBani } from '@/fields/money'

import { codeOnlyAccess, validateInteger } from './shared'

const MOVE_TYPES = [
  'opening',
  'purchase',
  'sale',
  'sale_cancel',
  'transfer_out',
  'transfer_in',
  'writeoff',
  'inventory',
  'reversal',
] as const

/** Журнал руху запасів: лише доповнюється кодом сервісу, див. docs/accounting/design.md, розд. 2.3. */
export const StockMoves: CollectionConfig = {
  slug: 'stock-moves',
  labels: { singular: 'Stock move', plural: 'Stock moves' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['date', 'product', 'warehouse', 'moveType', 'qtyDelta', 'valueDeltaBani', 'docNumber'],
    group: 'Stock',
  },
  defaultSort: '-date',
  indexes: [
    { fields: ['product', 'warehouse', 'date'] },
    { fields: ['docCollection', 'docId'] },
    { fields: ['date', 'moveType'] },
  ],
  fields: [
    { name: 'date', label: 'Date', type: 'date', required: true, index: true },
    { name: 'product', label: 'Product', type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: 'Variant',
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: 'Reserved, always empty' },
    },
    { name: 'warehouse', label: 'Warehouse', type: 'relationship', relationTo: 'warehouses', required: true },
    {
      name: 'qtyDelta',
      label: 'Quantity change',
      type: 'number',
      required: true,
      validate: validateInteger,
      admin: { description: '+ receipt, − issue' },
    },
    {
      name: 'valueDeltaBani',
      label: 'Value change, bani',
      type: 'number',
      required: true,
      validate: validateBani,
      admin: { description: 'At average cost; 0 for transfers' },
    },
    {
      name: 'unitCostBani',
      label: 'Average cost at the time of the move, bani',
      type: 'number',
      admin: { description: 'Fractional value, for reference' },
    },
    {
      name: 'moveType',
      label: 'Type',
      type: 'select',
      required: true,
      options: MOVE_TYPES.map((value) => ({ label: value, value })),
    },
    { name: 'docCollection', label: 'Document collection', type: 'text', required: true },
    { name: 'docId', label: 'Document ID', type: 'text', required: true },
    { name: 'docNumber', label: 'Document number', type: 'text' },
    { name: 'reversalOf', label: 'Reversal of', type: 'relationship', relationTo: 'stock-moves' },
  ],
}
