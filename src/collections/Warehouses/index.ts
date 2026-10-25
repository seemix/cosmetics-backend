import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

export const Warehouses: CollectionConfig = {
  slug: 'warehouses',
  labels: { singular: 'Склад', plural: 'Склади' },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'isActive', 'sortOrder'],
    group: 'Склад',
  },
  defaultSort: 'sortOrder',
  fields: [
    {
      name: 'name',
      label: 'Назва',
      type: 'text',
      required: true,
    },
    {
      name: 'code',
      label: 'Код',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'Стабільний ключ для налаштувань: main, shop',
      },
    },
    {
      name: 'isActive',
      label: 'Активний',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Неактивний склад не можна обрати в нових документах',
      },
    },
    {
      name: 'sortOrder',
      label: 'Порядок',
      type: 'number',
      defaultValue: 0,
    },
  ],
}
