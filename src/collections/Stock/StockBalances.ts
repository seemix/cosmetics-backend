import type { CollectionConfig } from 'payload'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш залишків: один документ на товар × склад, див. docs/accounting/design.md, розд. 2.3. */
export const StockBalances: CollectionConfig = {
  slug: 'stock-balances',
  labels: { singular: 'Stock balance', plural: 'Stock balances' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['product', 'warehouse', 'qty', 'updatedAt'],
    group: 'Stock',
  },
  indexes: [{ fields: ['product', 'variant', 'warehouse'], unique: true }],
  fields: [
    { name: 'product', label: 'Product', type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: 'Variant',
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: 'Reserved, always empty' },
    },
    { name: 'warehouse', label: 'Warehouse', type: 'relationship', relationTo: 'warehouses', required: true },
    { name: 'qty', label: 'Quantity', type: 'number', required: true, min: 0, validate: validateInteger },
  ],
}
