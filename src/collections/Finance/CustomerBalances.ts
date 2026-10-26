import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { codeOnlyAccess } from '@/collections/Stock/shared'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/**
 * Аванс клієнта: кеш Σ `customer-moves.advanceDeltaBani`, один документ на клієнта. Змінює лише
 * `customerBalance.service`, див. docs/accounting/design.md, розд. 6.4.
 */
export const CustomerBalances: CollectionConfig = {
  slug: 'customer-balances',
  labels: collectionLabels('custom:collection:customerBalances:singular', 'custom:collection:customerBalances:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['customer', 'balanceBani', 'updatedAt'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-balanceBani',
  fields: [
    { name: 'customer', label: label('custom:field:customer'), type: 'relationship', relationTo: 'users', required: true, unique: true },
    moneyField({
      name: 'balanceBani',
      label: label('custom:field:advanceBani'),
      required: true,
      defaultValue: 0,
      admin: { readOnly: true, description: description('custom:desc:customerAdvance') },
    }),
  ],
}
