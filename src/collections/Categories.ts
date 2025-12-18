import { slugField } from 'payload'
import type { CollectionConfig } from 'payload'

export const Categories: CollectionConfig = {
  slug: 'categories',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    group: 'Ecommerce',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      required: false,
      label: 'Parent Category',
    },
    slugField({
      // position: undefined,
      localized: false,
    }),
  ],
}
