import { CollectionConfig, slugField } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { getPageBySlug } from '@/collections/Pages/endpoints/getPageBySlug'

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    read: () => true,
  },
  admin: {
    group: 'Content',
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      localized: true,
    },
    slugField({localized: false}),
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor(),
      localized: true,
    }
  ],
  endpoints: [getPageBySlug]
}