import { CollectionConfig, slugField } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

export const Brands: CollectionConfig = {
  slug: 'brands',
  access: {
    read: () => true,
  },
  admin: {
    group: 'Ecommerce',
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: false,
    },
    slugField({
      // position: undefined,
      localized: false,
    }),
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'bigImage',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'description',
      type: 'richText',
      editor: lexicalEditor(),
      localized: true
    },

  ],
}