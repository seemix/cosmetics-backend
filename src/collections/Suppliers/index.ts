import type { CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { collectionLabels, description, label, localized } from '@/i18n'

/** `filterOptions` для relationship-полів на `suppliers` у документах: лише активні постачальники. */
export const activeSuppliersOnly: Where = { isActive: { equals: true } }

export const Suppliers: CollectionConfig = {
  slug: 'suppliers',
  labels: collectionLabels('custom:collection:suppliers:singular', 'custom:collection:suppliers:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'isCarrier', 'isActive'],
    listSearchableFields: ['name', 'idno', 'phone'],
    group: localized('custom:group:purchasing'),
  },
  defaultSort: 'name',
  fields: [
    {
      name: 'name',
      label: label('custom:term:name'),
      type: 'text',
      required: true,
      index: true,
    },
    {
      name: 'idno',
      label: label('custom:field:taxId'),
      type: 'text',
    },
    {
      type: 'row',
      fields: [
        { name: 'phone', label: label('custom:field:phone'), type: 'text' },
        { name: 'email', label: label('custom:field:email'), type: 'text' },
        { name: 'contactPerson', label: label('custom:field:contactPerson'), type: 'text' },
      ],
    },
    {
      name: 'bankDetails',
      label: label('custom:field:bankDetails'),
      type: 'textarea',
    },
    {
      name: 'isCarrier',
      label: label('custom:field:isCarrier'),
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: description('custom:desc:carrierPayee'),
      },
    },
    {
      name: 'isActive',
      label: label('custom:field:isActive'),
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: description('custom:desc:inactiveSupplier'),
      },
    },
    {
      name: 'notes',
      label: label('custom:field:notes'),
      type: 'textarea',
    },
  ],
}
