import type { CollectionConfig } from 'payload'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш залишків: один документ на товар × склад, див. docs/accounting/design.md, розд. 2.3. */
export const StockBalances: CollectionConfig = {
  slug: 'stock-balances',
  labels: { singular: 'Залишок', plural: 'Залишки' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['product', 'warehouse', 'qty', 'updatedAt'],
    group: 'Склад',
  },
  indexes: [{ fields: ['product', 'variant', 'warehouse'], unique: true }],
  fields: [
    { name: 'product', label: 'Товар', type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: 'Варіант',
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: 'Резерв, завжди порожнє' },
    },
    { name: 'warehouse', label: 'Склад', type: 'relationship', relationTo: 'warehouses', required: true },
    { name: 'qty', label: 'Кількість', type: 'number', required: true, min: 0, validate: validateInteger },
  ],
}
