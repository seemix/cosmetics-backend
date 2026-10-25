import { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { publicAccess } from '@/access/publicAccess'
import { getPosts } from '@/collections/Posts/endpoints/getPosts'
import { getSinglePost } from '@/collections/Posts/endpoints/getSinglePost'
import { localizedSlugField } from '@/fields/slug'
import { collectionLabels, label, localized } from '@/i18n'

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: collectionLabels('custom:collection:posts:singular', 'custom:collection:posts:plural'),
  access: {
    read: publicAccess,
  },
  admin: {
    group: localized('custom:group:content'),
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      label: label('custom:field:title'),
      type: 'text',
      localized: true,
      required: true,
    },
    localizedSlugField(),
    {
      name: 'slide',
      label: label('custom:field:slide'),
      type: 'upload',
      relationTo: 'media',
      required: true,
      localized: false,
    },
    {
      name: 'square-slide',
      label: label('custom:field:squareSlide'),
      type: 'upload',
      relationTo: 'media',
      required: true,
      localized: false,
    },
    {
      name: 'customLink',
      label: label('custom:field:customLink'),
      type: 'text',
      localized: false,
      required: false,
      admin: { position: 'sidebar' },
    },
    {
      name: 'excerpt',
      label: label('custom:field:excerpt'),
      type: 'textarea',
      localized: true,
      required: false,
      admin: {
        rows: 5,
      },
    },
    {
      name: 'content',
      label: label('custom:field:content'),
      type: 'richText',
      editor: lexicalEditor(),
      localized: true,
    },
  ],
  endpoints: [getPosts, getSinglePost],
}
