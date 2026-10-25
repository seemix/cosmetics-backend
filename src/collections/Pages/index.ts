import { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { publicAccess } from '@/access/publicAccess'
import { getPageBySlug } from '@/collections/Pages/endpoints/getPageBySlug'
import { localizedSlugField } from '@/fields/slug'
import { collectionLabels, label, localized } from '@/i18n'

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: collectionLabels('custom:collection:pages:singular', 'custom:collection:pages:plural'),
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
      required: true,
      localized: true,
    },
    localizedSlugField({ localized: false }),
    {
      name: 'content',
      label: label('custom:field:content'),
      type: 'richText',
      editor: lexicalEditor(),
      localized: true,
    }
  ],
  endpoints: [getPageBySlug]
}