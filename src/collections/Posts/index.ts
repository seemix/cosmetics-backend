import { CollectionConfig, slugField } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { getPosts } from '@/collections/Posts/endpoints/getPosts'
import { getSinglePost } from '@/collections/Posts/endpoints/getSinglePost'

export const Posts: CollectionConfig = {
  slug: 'posts',
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
      localized: true,
      required: true,
    },
    slugField(),
    {
      name: 'slide',
      type: 'upload',
      relationTo: 'media',
      required: true,
      localized: false,
    },
    {
      name: 'square-slide',
      type: 'upload',
      relationTo: 'media',
      required: true,
      localized: false,
    },
    {
      name: 'excerpt',
      type: 'textarea',
      localized: true,
      required: false,
      admin: {
        rows: 5,
      },
    },
    {
      name: 'content',
      type: 'richText',
      editor: lexicalEditor(),
      localized: true,
    },
  ],
  endpoints: [getPosts, getSinglePost],
}
