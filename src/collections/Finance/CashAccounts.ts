import type { CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/** `filterOptions` для relationship-полів на `cash-accounts` у документах: лише активні каси. */
export const activeCashAccountsOnly: Where = { isActive: { equals: true } }

/** Каси, див. docs/accounting/design.md, розд. 2.1, 6.1. `balanceBani` змінює лише проведення. */
export const CashAccounts: CollectionConfig = {
  slug: 'cash-accounts',
  labels: collectionLabels('custom:collection:cashAccounts:singular', 'custom:collection:cashAccounts:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'kind', 'balanceBani', 'isActive'],
    listSearchableFields: ['name', 'code'],
    group: localized('custom:group:finance'),
  },
  defaultSort: 'name',
  fields: [
    { name: 'name', label: label('custom:term:name'), type: 'text', required: true },
    {
      name: 'code',
      label: label('custom:field:code'),
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: description('custom:desc:cashAccountCode') },
    },
    {
      name: 'kind',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      defaultValue: 'cash',
      options: [
        { label: label('custom:option:accountCash'), value: 'cash' },
        { label: label('custom:option:accountBank'), value: 'bank' },
      ],
    },
    moneyField({
      name: 'balanceBani',
      label: label('custom:field:balanceBani'),
      defaultValue: 0,
      // Кеш Σ cash-moves: ні REST, ні адмінка його не змінюють, лише сервіс `cashLedger`.
      access: { create: () => false, update: () => false },
      admin: { readOnly: true, description: description('custom:desc:balanceCache') },
    }),
    {
      name: 'allowNegative',
      label: label('custom:field:allowNegative'),
      type: 'checkbox',
      defaultValue: false,
      admin: { description: description('custom:desc:allowNegative') },
    },
    {
      name: 'isActive',
      label: label('custom:field:isActive'),
      type: 'checkbox',
      defaultValue: true,
      admin: { description: description('custom:desc:inactiveCashAccount') },
    },
  ],
}
