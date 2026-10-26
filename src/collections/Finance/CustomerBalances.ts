import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { codeOnlyAccess } from '@/collections/Stock/shared'
import { customerStatement } from '@/endpoints/customerStatement'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/**
 * Баланс клієнта, один документ на клієнта; змінює лише `customerBalance.service`, див.
 * docs/accounting/design.md, розд. 6.4. `balanceBani` (аванс) = Σ `customer-moves.advanceDeltaBani`;
 * `debtBani` = Σ боргів по замовленнях; `netBani` = борг − аванс. Виписка за період: розд. 6.5.
 */
export const CustomerBalances: CollectionConfig = {
  slug: 'customer-balances',
  labels: collectionLabels('custom:collection:customerBalances:singular', 'custom:collection:customerBalances:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['customer', 'debtBani', 'balanceBani', 'netBani', 'updatedAt'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-netBani',
  endpoints: [customerStatement],
  fields: [
    { name: 'customer', label: label('custom:field:customer'), type: 'relationship', relationTo: 'users', required: true, unique: true },
    {
      type: 'row',
      fields: [
        moneyField({
          name: 'debtBani',
          label: label('custom:field:debtBani'),
          defaultValue: 0,
          index: true,
          admin: { readOnly: true, description: description('custom:desc:customerDebt') },
        }),
        moneyField({
          name: 'balanceBani',
          label: label('custom:field:advanceBani'),
          required: true,
          defaultValue: 0,
          admin: { readOnly: true, description: description('custom:desc:customerAdvance') },
        }),
        moneyField({
          name: 'netBani',
          label: label('custom:field:netBani'),
          defaultValue: 0,
          index: true,
          admin: { readOnly: true, description: description('custom:desc:customerNet') },
        }),
      ],
    },
    {
      name: 'statement',
      type: 'ui',
      // Заголовок блоку виводить сам компонент: `ui` не приймає мітку-функцію.
      admin: { components: { Field: '@/collections/Finance/components/StatementDownload#StatementDownload' } },
    },
  ],
}
