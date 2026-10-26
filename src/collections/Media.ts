import type { CollectionConfig } from 'payload'

import path from 'path'
import { fileURLToPath } from 'url'
import { adminOrManager } from '@/access/adminOrManager'
import { publicAccess } from '@/access/publicAccess'
import { generateBlurHash } from '@/hooks/generateBlurHash'
import { collectionLabels, label, localized } from '@/i18n'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export const Media: CollectionConfig = {
  admin: {
    group: localized('custom:group:content'),
  },
  slug: 'media',
  labels: collectionLabels('custom:collection:media:singular', 'custom:collection:media:plural'),
  // Читають усі; запис лише admin і manager (без цього діяв дефолт «будь-який авторизований», зокрема customer).
  access: {
    create: adminOrManager,
    read: publicAccess,
    update: adminOrManager,
    delete: adminOrManager,
  },

  fields: [
    {
      name: 'alt',
      label: label('custom:field:alt'),
      type: 'text',
      required: true,
    },
    {
      name: 'caption',
      label: label('custom:field:caption'),
      type: 'text',
    },
    {
      name: 'blurHash',
      type: 'text',
      admin: {
        hidden: true,
        disableListColumn: true,
      },
    },
  ],
  upload: {
    staticDir: path.resolve(dirname, '../../public/media'),
    mimeTypes: ['image/*'],
    adminThumbnail: 'thumbnail',
    imageSizes: [
      {
        height: 96,
        width: 96,
        formatOptions: {
          format: 'webp',
          options: {
            quality: 85,
          },
        },
        position: 'centre',
        name: 'thumbnail',
      },
      {
        height: 400,
        width: 400,
        formatOptions: {
          format: 'webp',
          options: {
            quality: 95,
          },
        },

        position: 'centre',
        name: 'medium',
      },
    ],
  },

  hooks: {
    beforeValidate: [generateBlurHash],
  },
}
