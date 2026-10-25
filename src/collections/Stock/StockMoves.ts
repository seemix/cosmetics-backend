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
  labels: { singular: 'Рух запасів', plural: 'Журнал запасів' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['date', 'product', 'warehouse', 'moveType', 'qtyDelta', 'valueDeltaBani', 'docNumber'],
    group: 'Склад',
  },
  defaultSort: '-date',
  indexes: [
    { fields: ['product', 'warehouse', 'date'] },
    { fields: ['docCollection', 'docId'] },
    { fields: ['date', 'moveType'] },
  ],
  fields: [
    { name: 'date', label: 'Дата', type: 'date', required: true, index: true },
    { name: 'product', label: 'Товар', type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: 'Варіант',
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: 'Резерв, завжди порожнє' },
    },
    { name: 'warehouse', label: 'Склад', type: 'relationship', relationTo: 'warehouses', required: true },
    {
      name: 'qtyDelta',
      label: 'Зміна кількості',
      type: 'number',
      required: true,
      validate: validateInteger,
      admin: { description: '+ прихід, − витрата' },
    },
    {
      name: 'valueDeltaBani',
      label: 'Зміна вартості, бані',
      type: 'number',
      required: true,
      validate: validateBani,
      admin: { description: 'За середньою; для переміщень 0' },
    },
    {
      name: 'unitCostBani',
      label: 'Середня на момент руху, бані',
      type: 'number',
      admin: { description: 'Дробове значення, довідково' },
    },
    {
      name: 'moveType',
      label: 'Тип',
      type: 'select',
      required: true,
      options: MOVE_TYPES.map((value) => ({ label: value, value })),
    },
    { name: 'docCollection', label: 'Колекція документа', type: 'text', required: true },
    { name: 'docId', label: 'ID документа', type: 'text', required: true },
    { name: 'docNumber', label: 'Номер документа', type: 'text' },
    { name: 'reversalOf', label: 'Сторно руху', type: 'relationship', relationTo: 'stock-moves' },
  ],
}
