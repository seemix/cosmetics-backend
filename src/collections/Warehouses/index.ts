import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOrManager } from '@/access/adminOrManager'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { collectionLabels, description, label, localized } from '@/i18n'

export const Warehouses: CollectionConfig = {
  slug: 'warehouses',
  labels: collectionLabels('custom:collection:warehouses:singular', 'custom:collection:warehouses:plural'),
  access: {
    // Менеджер обирає склад у замовленні (розд. 9.3); у сайдбарі склади для нього сховані.
    read: adminOrManager,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'isActive', 'sortOrder'],
    group: localized('custom:group:stock'),
  },
  defaultSort: 'sortOrder',
  fields: [
    {
      name: 'name',
      label: label('custom:term:name'),
      type: 'text',
      required: true,
    },
    {
      name: 'code',
      label: label('custom:field:code'),
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: description('custom:desc:warehouseCode'),
      },
    },
    {
      name: 'isActive',
      label: label('custom:field:isActive'),
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: description('custom:desc:inactiveWarehouse'),
      },
    },
    {
      name: 'sortOrder',
      label: label('custom:field:sortOrder'),
      type: 'number',
      defaultValue: 0,
    },
  ],
}
