import type { GlobalConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

const activeWarehouse = { isActive: { equals: true } }

export const AccountingSettings: GlobalConfig = {
  slug: 'accounting-settings',
  label: 'Налаштування обліку',
  access: {
    read: adminOnly,
    update: adminOnly,
  },
  admin: {
    group: 'Склад',
  },
  fields: [
    {
      name: 'stockControlEnabled',
      label: 'Облік залишків увімкнено',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Замовлення списують залишок. Вмикати лише після проведення початкових залишків (docs/accounting/design.md, розд. 10).',
      },
    },
    {
      name: 'accountingStartAt',
      label: 'Облік запущено',
      type: 'date',
      admin: {
        readOnly: true,
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Ставиться разом із вмиканням обліку',
      },
    },
    {
      name: 'defaultWebWarehouse',
      label: 'Склад для замовлень із сайту',
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: activeWarehouse,
    },
    {
      name: 'defaultAdminWarehouse',
      label: 'Склад за замовчуванням в адмінці',
      type: 'relationship',
      relationTo: 'warehouses',
      filterOptions: activeWarehouse,
    },
    {
      name: 'lockedUntil',
      label: 'Закритий період до',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Проведення й сторно з датою не пізніше цієї заборонені',
      },
    },
    {
      name: 'assignOrderToCreatorIfNoManager',
      label: 'Записувати замовлення на автора, якщо у клієнта немає менеджера',
      type: 'checkbox',
      defaultValue: false,
    },
  ],
}
