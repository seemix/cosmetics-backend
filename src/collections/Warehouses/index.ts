import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

export const Warehouses: CollectionConfig = {
  slug: 'warehouses',
  labels: { singular: 'Warehouse', plural: 'Warehouses' },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'isActive', 'sortOrder'],
    group: 'Stock',
  },
  defaultSort: 'sortOrder',
  fields: [
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    },
    {
      name: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Stable key used in settings: main, shop',
      },
    },
    {
      name: 'isActive',
      label: 'Active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'An inactive warehouse cannot be selected in new documents',
      },
    },
    {
      name: 'sortOrder',
      label: 'Sort order',
      type: 'number',
      defaultValue: 0,
    },
  ],
}
