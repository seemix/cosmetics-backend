import type { GlobalBeforeChangeHook, GlobalConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { description, label, localized } from '@/i18n'

const activeWarehouse = { isActive: { equals: true } }

/**
 * Дата початку обліку ставиться сама при першому вмиканні контролю залишків (runbook, крок 6):
 * в адмінці поле лише для читання. Вже задану дату й явне значення з Local API хук не змінює.
 */
const stampAccountingStart: GlobalBeforeChangeHook = ({ data, originalDoc }) => {
  const enabling = data.stockControlEnabled === true && originalDoc?.stockControlEnabled !== true
  if (enabling && !originalDoc?.accountingStartAt && !data.accountingStartAt) {
    data.accountingStartAt = new Date().toISOString()
  }
  return data
}

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
  hooks: { beforeChange: [stampAccountingStart] },
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
