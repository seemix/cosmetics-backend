import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш середньої собівартості: один документ на товар, див. docs/accounting/design.md, розд. 2.3. */
export const ProductCosts: CollectionConfig = {
  slug: 'product-costs',
  labels: collectionLabels('custom:collection:productCosts:singular', 'custom:collection:productCosts:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['product', 'qty', 'valueBani', 'avgCostBani'],
    group: localized('custom:group:stock'),
  },
  fields: [
    {
      name: 'product',
      label: label('custom:term:product'),
      type: 'relationship',
      relationTo: 'products',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'qty',
      label: label('custom:term:quantity'),
      type: 'number',
      required: true,
      min: 0,
      validate: validateInteger,
      admin: { description: description('custom:desc:totalAllWarehouses') },
    },
    moneyField({
      name: 'valueBani',
      label: label('custom:field:valueBani'),
      required: true,
      min: 0,
      admin: { description: description('custom:desc:zeroValue') },
    }),
    moneyField({
      name: 'avgCostBani',
      label: label('custom:field:avgCostBani'),
      fractional: true,
      virtual: true,
      admin: { description: description('custom:desc:avgCostFormula') },
      hooks: {
        afterRead: [
          ({ siblingData }) => {
            const { qty, valueBani } = siblingData as { qty?: number; valueBani?: number }

            return qty && valueBani !== undefined ? valueBani / qty : 0
          },
        ],
      },
    }),
    moneyField({
      name: 'lastPurchaseUnitCostBani',
      label: label('custom:field:lastPurchaseUnitCostBani'),
      fractional: true,
      admin: { description: description('custom:desc:forReference') },
    }),
  ],
}
