import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { validateBani } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'
import type { CustomTranslationsKeys } from '@/i18n'

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

const MOVE_TYPE_LABELS: Record<(typeof MOVE_TYPES)[number], CustomTranslationsKeys> = {
  opening: 'custom:moveType:opening',
  purchase: 'custom:moveType:purchase',
  sale: 'custom:moveType:sale',
  sale_cancel: 'custom:moveType:saleCancel',
  transfer_out: 'custom:moveType:transferOut',
  transfer_in: 'custom:moveType:transferIn',
  writeoff: 'custom:moveType:writeoff',
  inventory: 'custom:moveType:inventory',
  reversal: 'custom:moveType:reversal',
}

/** Журнал руху запасів: лише доповнюється кодом сервісу, див. docs/accounting/design.md, розд. 2.3. */
export const StockMoves: CollectionConfig = {
  slug: 'stock-moves',
  labels: collectionLabels('custom:collection:stockMoves:singular', 'custom:collection:stockMoves:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['date', 'product', 'warehouse', 'moveType', 'qtyDelta', 'valueDeltaBani', 'docNumber'],
    group: localized('custom:group:stock'),
  },
  defaultSort: '-date',
  indexes: [
    { fields: ['product', 'warehouse', 'date'] },
    { fields: ['docCollection', 'docId'] },
    { fields: ['date', 'moveType'] },
    // Звіт прибутку (R1): втрати складу = рухи `stock-adjustments` за період.
    { fields: ['docCollection', 'date'] },
  ],
  fields: [
    { name: 'date', label: label('custom:term:date'), type: 'date', required: true, index: true },
    { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: label('custom:field:variant'),
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: description('custom:desc:reservedEmpty') },
    },
    { name: 'warehouse', label: label('custom:term:warehouse'), type: 'relationship', relationTo: 'warehouses', required: true },
    {
      name: 'qtyDelta',
      label: label('custom:field:qtyDelta'),
      type: 'number',
      required: true,
      validate: validateInteger,
      admin: { description: description('custom:desc:qtyDelta') },
    },
    {
      name: 'valueDeltaBani',
      label: label('custom:field:valueDeltaBani'),
      type: 'number',
      required: true,
      validate: validateBani,
      admin: { description: description('custom:desc:valueDelta') },
    },
    {
      name: 'unitCostBani',
      label: label('custom:field:unitCostBani'),
      type: 'number',
      admin: { description: description('custom:desc:unitCostFractional') },
    },
    {
      name: 'moveType',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      options: MOVE_TYPES.map((value) => ({ label: label(MOVE_TYPE_LABELS[value]), value })),
    },
    { name: 'docCollection', label: label('custom:field:docCollection'), type: 'text', required: true },
    { name: 'docId', label: label('custom:field:docId'), type: 'text', required: true },
    { name: 'docNumber', label: label('custom:field:docNumber'), type: 'text' },
    { name: 'reversalOf', label: label('custom:field:reversalOf'), type: 'relationship', relationTo: 'stock-moves' },
  ],
}
