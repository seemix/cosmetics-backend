import type { CollectionConfig } from 'payload'

import { validateBani } from '@/fields/money'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш середньої собівартості: один документ на товар, див. docs/accounting/design.md, розд. 2.3. */
export const ProductCosts: CollectionConfig = {
  slug: 'product-costs',
  labels: { singular: 'Собівартість товару', plural: 'Собівартість товарів' },
  access: codeOnlyAccess,
  admin: {
    defaultColumns: ['product', 'qty', 'valueBani', 'avgCostBani'],
    group: 'Склад',
  },
  fields: [
    {
      name: 'product',
      label: 'Товар',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'qty',
      label: 'Кількість',
      type: 'number',
      required: true,
      min: 0,
      validate: validateInteger,
      admin: { description: 'Сума по всіх складах' },
    },
    {
      name: 'valueBani',
      label: 'Вартість залишку, бані',
      type: 'number',
      required: true,
      min: 0,
      validate: validateBani,
      admin: { description: 'Якщо кількість 0, то й вартість 0' },
    },
    {
      name: 'avgCostBani',
      label: 'Середня, бані',
      type: 'number',
      virtual: true,
      admin: { readOnly: true, description: 'valueBani / qty, дробове, лише показ' },
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
      label: 'Остання закупівельна ціна, бані',
      type: 'number',
      admin: { description: 'Довідково' },
    },
  ],
}
