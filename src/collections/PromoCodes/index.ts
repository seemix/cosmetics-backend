import type { CollectionConfig, FieldHook } from 'payload'

import { generatePromo } from './services/generatePromo'
import { generateUniquePromo } from '@/collections/PromoCodes/hooks/generateUniquePromo'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
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
      hooks: {
        beforeValidate: [generateUniquePromo as FieldHook]
      },
    },
    {
      name: 'discount %',
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
      name: 'maxUses',
      type: 'number',
      admin: {
        description: '(Empty if unlimited)',
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