import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'

import { generatePromo } from './services/generatePromo'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'code',
    group: 'Ecommerce',
    components: {

    }
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      defaultValue: () => generatePromo(5),
    },
    {
      name: 'wholesale',
      type: 'checkbox',
      defaultValue: false
    },
    {
      name: 'discountPercent',
      label: 'Discount %',
      type: 'number',
      required: true,
      defaultValue: 10,
    },
    {
      name: 'brands',
      type: 'relationship',
      relationTo: 'brands',
      hasMany: true,
      required: false,
      admin: {
        description: '(Not selected: ALL brands)',
      },
    },
    {
      name: 'expirationDate',
      type: 'date',
      admin: {
        description: '(Empty if permanent)',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
    },
  ],
}