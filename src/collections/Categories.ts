import type { CollectionConfig } from 'payload'

import { adminOrManager } from '@/access/adminOrManager'
import { publicAccess } from '@/access/publicAccess'
import { localizedSlugField } from '@/fields/slug'
import { collectionLabels, label, localized } from '@/i18n'

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: collectionLabels('custom:collection:categories:singular', 'custom:collection:categories:plural'),
  // Читають усі; запис лише admin і manager (без цього діяв дефолт «будь-який авторизований», зокрема customer).
  access: {
    create: adminOrManager,
    read: publicAccess,
    update: adminOrManager,
    delete: adminOrManager,
  },
  admin: {
    useAsTitle: 'title',
    group: localized('custom:group:ecommerce'),
  },
  fields: [
    {
      name: 'title',
      label: label('custom:field:title'),
      type: 'text',
      required: true,
      localized: true,
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      required: false,
      label: label('custom:field:parentCategory'),
    },
    localizedSlugField({
      // position: undefined,
      localized: false,
    }),
  ],
}
