import type { CollectionConfig } from 'payload'

import { validateBani } from '@/fields/money'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш середньої собівартості: один документ на товар, див. docs/accounting/design.md, розд. 2.3. */
export const ProductCosts: CollectionConfig = {
  slug: 'product-costs',
  labels: { singular: 'Product cost', plural: 'Product costs' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['product', 'qty', 'valueBani', 'avgCostBani'],
    group: 'Stock',
  },
  fields: [
    {
      name: 'product',
      label: 'Product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'qty',
      label: 'Quantity',
      type: 'number',
      required: true,
      min: 0,
      validate: validateInteger,
      admin: { description: 'Total across all warehouses' },
    },
    {
      name: 'valueBani',
      label: 'Stock value, bani',
      type: 'number',
      required: true,
      min: 0,
      validate: validateBani,
      admin: { description: 'If quantity is 0, value is 0 too' },
    },
    {
      name: 'avgCostBani',
      label: 'Average cost, bani',
      type: 'number',
      virtual: true,
      admin: { readOnly: true, description: 'valueBani / qty, fractional, display only' },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            const { qty, valueBani } = siblingData as { qty?: number; valueBani?: number }

            return qty && valueBani !== undefined ? valueBani / qty : 0
          },
        ],
      },
    },
    {
      name: 'lastPurchaseUnitCostBani',
      label: 'Last purchase unit cost, bani',
      type: 'number',
      admin: { description: 'For reference' },
    },
  ],
}
