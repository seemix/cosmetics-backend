import type { CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'

/** `filterOptions` для relationship-полів на `suppliers` у документах: лише активні постачальники. */
export const activeSuppliersOnly: Where = { isActive: { equals: true } }

export const Suppliers: CollectionConfig = {
  slug: 'suppliers',
  labels: { singular: 'Постачальник', plural: 'Постачальники' },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'isCarrier', 'isActive'],
    listSearchableFields: ['name', 'idno', 'phone'],
    group: 'Закупівлі',
  },
  defaultSort: 'name',
  fields: [
    {
      name: 'name',
      label: 'Назва',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'idno',
      label: 'Фіскальний код',
      type: 'text',
    },
    {
      type: 'row',
      fields: [
        { name: 'phone', label: 'Телефон', type: 'text' },
        { name: 'email', label: 'Email', type: 'text' },
        { name: 'contactPerson', label: 'Контактна особа', type: 'text' },
      ],
    },
    {
      name: 'bankDetails',
      label: 'Банківські реквізити',
      type: 'textarea',
    },
    {
      name: 'isCarrier',
      label: 'Перевізник',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Може бути отримувачем коштів за логістику в накладній',
      },
    },
    {
      name: 'isActive',
      label: 'Активний',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Неактивного постачальника не можна обрати в нових документах',
      },
    },
    {
      name: 'notes',
      label: 'Нотатки',
      type: 'textarea',
    },
  ],
}
