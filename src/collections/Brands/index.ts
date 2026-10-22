import { CollectionConfig, slugField } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { publicAccess } from '@/access/publicAccess'
import { getBrandInfo } from '@/collections/Brands/endpoints/getBrandInfo'

export const Brands: CollectionConfig = {
  slug: 'brands',
  access: {
    read: publicAccess,
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
      localized: true,
    },
  ],
  endpoints: [getBrandInfo],
}