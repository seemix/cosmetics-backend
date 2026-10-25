import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { collectionLabels, description, label, localized } from '@/i18n'

export const Warehouses: CollectionConfig = {
  slug: 'warehouses',
  labels: collectionLabels('custom:collection:warehouses:singular', 'custom:collection:warehouses:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
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
