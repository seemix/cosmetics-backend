import type { CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'

/** `filterOptions` для relationship-полів на `suppliers` у документах: лише активні постачальники. */
export const activeSuppliersOnly: Where = { isActive: { equals: true } }

export const Suppliers: CollectionConfig = {
  slug: 'suppliers',
  labels: { singular: 'Supplier', plural: 'Suppliers' },
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
    group: 'Purchasing',
  },
  defaultSort: 'name',
  fields: [
    {
      name: 'name',
      label: 'Name',
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'idno',
      label: 'Tax ID',
      type: 'text',
    },
    {
      type: 'row',
      fields: [
        { name: 'phone', label: 'Phone', type: 'text' },
        { name: 'email', label: 'Email', type: 'text' },
        { name: 'contactPerson', label: 'Contact person', type: 'text' },
      ],
    },
    {
      name: 'bankDetails',
      label: 'Bank details',
      type: 'textarea',
    },
    {
      name: 'isCarrier',
      label: 'Carrier',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Can be the payee of logistics costs in a purchase',
      },
    },
    {
      name: 'isActive',
      label: 'Active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'An inactive supplier cannot be selected in new documents',
      },
    },
    {
      name: 'notes',
      label: 'Notes',
      type: 'textarea',
    },
  ],
}
