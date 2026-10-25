import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

import { collectionLabels, description, label, localized } from '@/i18n'

import { generatePromo } from './services/generatePromo'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  labels: collectionLabels('custom:collection:promoCodes:singular', 'custom:collection:promoCodes:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'code',
    group: localized('custom:group:ecommerce'),
    components: {

    }
  },
  fields: [
    {
      name: 'code',
      label: label('custom:field:code'),
      type: 'text',
      required: true,
      unique: true,
      index: true,
      defaultValue: () => generatePromo(5),
    },
    {
      name: 'wholesale',
      label: label('custom:field:wholesale'),
      type: 'checkbox',
      defaultValue: false
    },
    {
      name: 'discountPercent',
      label: label('custom:field:discountPercent'),
      type: 'number',
      required: true,
      defaultValue: 10,
    },
    {
      name: 'brands',
      label: label('custom:field:brands'),
      type: 'relationship',
      relationTo: 'brands',
      hasMany: true,
      required: false,
      admin: {
        description: description('custom:desc:allBrands'),
      },
    },
    {
      name: 'expirationDate',
      label: label('custom:field:expirationDate'),
      type: 'date',
      admin: {
        description: description('custom:desc:permanent'),
      },
    },
    {
      name: 'isActive',
      label: label('custom:field:isActive'),
      type: 'checkbox',
      defaultValue: true,
    },
  ],
}