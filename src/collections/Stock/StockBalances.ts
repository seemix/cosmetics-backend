import type { CollectionConfig } from 'payload'

import { adminOrManager } from '@/access/adminOrManager'
import { hiddenUnlessAdminOrManager } from '@/access/isAdmin'
import { collectionLabels, description, label, localized } from '@/i18n'

import { codeOnlyAccess, validateInteger } from './shared'

/** Кеш залишків: один документ на товар × склад, див. docs/accounting/design.md, розд. 2.3. */
export const StockBalances: CollectionConfig = {
  slug: 'stock-balances',
  labels: collectionLabels('custom:collection:stockBalances:singular', 'custom:collection:stockBalances:plural'),
  // В11: менеджер бачить кількість по складах (і в сайдбарі); вартості тут немає, вона в `product-costs`.
  access: { ...codeOnlyAccess, read: adminOrManager },
  admin: {
    hidden: hiddenUnlessAdminOrManager,
    defaultColumns: ['product', 'warehouse', 'qty', 'updatedAt'],
    group: localized('custom:group:stock'),
  },
  indexes: [{ fields: ['product', 'variant', 'warehouse'], unique: true }],
  fields: [
    { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
    {
      name: 'variant',
      label: label('custom:field:variant'),
      type: 'relationship',
      relationTo: 'variants',
      admin: { description: description('custom:desc:reservedEmpty') },
    },
    { name: 'warehouse', label: label('custom:term:warehouse'), type: 'relationship', relationTo: 'warehouses', required: true },
    { name: 'qty', label: label('custom:term:quantity'), type: 'number', required: true, min: 0, validate: validateInteger },
  ],
}
