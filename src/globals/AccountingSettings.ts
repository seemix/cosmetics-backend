import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

const activeWarehouse = { isActive: { equals: true } }

export const AccountingSettings: GlobalConfig = {
  slug: 'accounting-settings',
  label: 'Accounting settings',
  access: {
    read: adminOnly,
    update: adminOnly,
  },
  admin: {
    group: 'Stock',
  },
  fields: [
    {
      name: 'stockControlEnabled',
      label: 'Stock control enabled',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Orders deduct stock. Enable only after the opening balances are posted (docs/accounting/design.md, section 10).',
      },
    },
    {
      name: 'accountingStartAt',
      label: 'Accounting started at',
      type: 'date',
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Set together with enabling stock control',
      },
    },
    {
      name: 'defaultWebWarehouse',
      label: 'Warehouse for web orders',
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: activeWarehouse,
    },
    {
      name: 'defaultAdminWarehouse',
      label: 'Default warehouse in the admin panel',
      type: 'relationship',
      relationTo: 'warehouses',
      filterOptions: activeWarehouse,
    },
    {
      name: 'lockedUntil',
      label: 'Period locked until',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Posting and reversal dated on or before this are forbidden',
      },
    },
    {
      name: 'assignOrderToCreatorIfNoManager',
      label: 'Assign the order to its creator if the customer has no manager',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}
