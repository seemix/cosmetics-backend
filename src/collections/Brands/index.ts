import { CollectionConfig } from 'payload'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { adminOrManager } from '@/access/adminOrManager'
import { publicAccess } from '@/access/publicAccess'
import { getBrandInfo } from '@/collections/Brands/endpoints/getBrandInfo'
import { localizedSlugField } from '@/fields/slug'
import { collectionLabels, label, localized } from '@/i18n'

export const Brands: CollectionConfig = {
  slug: 'brands',
  labels: collectionLabels('custom:collection:brands:singular', 'custom:collection:brands:plural'),
  // Читають усі; запис лише admin і manager (без цього діяв дефолт «будь-який авторизований», зокрема customer).
  access: {
    create: adminOrManager,
    read: publicAccess,
    update: adminOrManager,
    delete: adminOrManager,
  },
  admin: {
    group: localized('custom:group:ecommerce'),
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      label: label('custom:field:title'),
      type: 'text',
      localized: false,
    },
    localizedSlugField({
      localized: false,
    }),
    {
      name: 'logo',
      label: label('custom:field:logo'),
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'bigImage',
      label: label('custom:field:bigImage'),
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'description',
      label: label('custom:field:description'),
      type: 'richText',
      editor: lexicalEditor(),
      localized: true,
    },
  ],
  endpoints: [getBrandInfo],
}