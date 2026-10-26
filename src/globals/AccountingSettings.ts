import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { description, label, localized } from '@/i18n'

const activeWarehouse = { isActive: { equals: true } }

export const AccountingSettings: GlobalConfig = {
  slug: 'accounting-settings',
  label: label('custom:global:accountingSettings'),
  access: {
    read: adminOnly,
    update: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    group: localized('custom:group:stock'),
  },
  fields: [
    {
      name: 'stockControlEnabled',
      label: label('custom:field:stockControlEnabled'),
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: description('custom:desc:stockControl'),
      },
    },
    {
      name: 'accountingStartAt',
      label: label('custom:field:accountingStartAt'),
      type: 'date',
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime' },
        description: description('custom:desc:accountingStart'),
      },
    },
    {
      name: 'defaultWebWarehouse',
      label: label('custom:field:defaultWebWarehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: activeWarehouse,
    },
    {
      name: 'defaultAdminWarehouse',
      label: label('custom:field:defaultAdminWarehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      filterOptions: activeWarehouse,
    },
    {
      name: 'lockedUntil',
      label: label('custom:field:lockedUntil'),
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: description('custom:desc:lockedUntil'),
      },
    },
    {
      name: 'assignOrderToCreatorIfNoManager',
      label: label('custom:field:assignOrderToCreator'),
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}
