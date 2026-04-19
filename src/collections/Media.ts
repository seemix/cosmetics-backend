import type { CollectionConfig } from 'payload'

import path from 'path'
import { fileURLToPath } from 'url'
import { generateBlurHash } from '@/hooks/generateBlurHash'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export const Media: CollectionConfig = {
  admin: {
    group: 'Content',
  },
  slug: 'media',
  access: {
    read: () => true,
  },

  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'caption',
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
