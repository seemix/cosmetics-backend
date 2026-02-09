import { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access:{
    read: () => true
  },
  admin: {
    group: 'Content',
    useAsTitle: 'title'
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true
    },
    {
      name: 'slide',
      type: 'upload',
      relationTo: 'media',
      required: true,
      localized: false
    },
    {
      name: 'excerpt',
      type: 'textarea',
      localized: true,
      required: true,
      admin: {
        rows: 5
      }
    },
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor()
    }
  ]
}
