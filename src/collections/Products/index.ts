import { slugField } from 'payload'
import { generatePreviewPath } from '@/utilities/generatePreviewPath'
import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import {
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  InlineToolbarFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import { DefaultDocumentIDType, Where } from 'payload'
import { populateRelatedProducts } from '@/hooks/relatedProducts'
import { hideStockFields } from '@/services/hideStockProductFields'
import { getProductsByCategory } from '@/collections/Products/endpoints/getProductsByCategory'
import { getProductsByBrand } from '@/collections/Products/endpoints/getProductsByBrand'
import { searchProducts } from '@/collections/Products/endpoints/searchProducts'
import { getBestSellers } from '@/collections/Products/endpoints/getBestSellers'
import { autoTranslate } from '@/collections/Products/hooks/autoTranslate'


// @ts-ignore
export const ProductsCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  versions: {
    drafts: true,
    maxPerDoc: 2,
  },
  pagination: {
    defaultLimit: 12,
  },
  admin: {
    ...defaultCollection?.admin,
    defaultColumns: ['title', 'enableVariants', '_status', 'variants.variants'],
    livePreview: {
      url: ({ data, req }) =>
        generatePreviewPath({
          slug: data?.slug,
          collection: 'products',
          req,
        }),
    },
    preview: (data, { req }) =>
      generatePreviewPath({
        slug: data?.slug as string,
        collection: 'products',
        req,
      }),
    useAsTitle: 'title',
  },
  defaultPopulate: {
    ...defaultCollection?.defaultPopulate,
    title: true,
    slug: true,
    variantOptions: true,
    variants: true,
    retailPrice: true,
    wholesalePrice: true,
    enableVariants: true,
    gallery: true,
  },
  fields: [
    { name: 'title', type: 'text', localized: false, required: true },
    { name: 'subtitle', type: 'text', localized: true, required: true },
    { name: 'article', type: 'text', localized: false, required: true, admin: { position: 'sidebar' } },
    { name: 'brand', type: 'relationship', relationTo: 'brands', required: true, admin: { position: 'sidebar' } },
    { name: 'retailPrice', type: 'number', required: true, defaultValue: 0, admin: { position: 'sidebar' } },
    { name: 'action', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'bestSeller', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'unavailable', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },

    {
      name: 'wholesalePrice', type: 'number', admin: { position: 'sidebar' },
      access: {
        read: ({ req }) => {
          return req.user?.wholesale === true
        },
      },
    },
    {
      name: 'shortDescription',
      type: 'textarea',
      localized: true,
      admin: {
        rows: 10,
      },
    },

    ...hideStockFields(defaultCollection.fields),
    {
      type: 'tabs',
      tabs: [
        {
          fields: [
            {
              name: 'description',
              type: 'richText',
              editor: lexicalEditor({
                features: ({ rootFeatures }) => {
                  return [
                    ...rootFeatures,
                    HeadingFeature({ enabledHeadingSizes: ['h1', 'h2', 'h3', 'h4'] }),
                    FixedToolbarFeature(),
                    InlineToolbarFeature(),
                    HorizontalRuleFeature(),
                  ]
                },
              }),
              label: false,
              required: false,
            },
            {
              name: 'gallery',
              type: 'array',
              minRows: 1,
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  required: true,
                },
                {
                  name: 'variantOption',
                  type: 'relationship',
                  relationTo: 'variantOptions',
                  admin: {
                    condition: (data) => {
                      return data?.enableVariants === true && data?.variantTypes?.length > 0
                    },
                  },
                  filterOptions: ({ data }) => {
                    if (data?.enableVariants && data?.variantTypes?.length) {
                      const variantTypeIDs = data.variantTypes.map((item: any) => {
                        if (typeof item === 'object' && item?.id) {
                          return item.id
                        }
                        return item
                      }) as DefaultDocumentIDType[]

                      if (variantTypeIDs.length === 0)
                        return {
                          variantType: {
                            in: [],
                          },
                        }

                      const query: Where = {
                        variantType: {
                          in: variantTypeIDs,
                        },
                      }

                      return query
                    }

                    return {
                      variantType: {
                        in: [],
                      },
                    }
                  },
                },
              ],
            },
          ],
          label: 'Content',
        },
        {
          fields: [
            {
              name: 'relatedProducts',
              type: 'relationship',
              filterOptions: ({ id }) => {
                if (id) {
                  return {
                    id: {
                      not_in: [id],
                    },
                  }
                }

                return {
                  id: {
                    exists: true,
                  },
                }
              },
              hasMany: true,
              relationTo: 'products',
            },
          ],
          label: 'Product Details',
        },
        // {
        //   name: 'meta',
        //   label: 'SEO',
        //   fields: [
        //     OverviewField({
        //       titlePath: 'meta.title',
        //       descriptionPath: 'meta.description',
        //       imagePath: 'meta.image',
        //     }),
        //     MetaTitleField({
        //       hasGenerateFn: true,
        //     }),
        //     MetaImageField({
        //       relationTo: 'media',
        //     }),
        //
        //     MetaDescriptionField({}),
        //     PreviewField({
        //       // if the `generateUrl` function is configured
        //       hasGenerateFn: true,
        //
        //       // field paths to match the target field for data
        //       titlePath: 'meta.title',
        //       descriptionPath: 'meta.description',
        //     }),
        //   ],
        // },
      ],
    },
    {
      name: 'categories',
      type: 'relationship',
      admin: {
        position: 'sidebar',
        sortOptions: 'title',
      },
      hasMany: true,
      relationTo: 'categories',
    },
    slugField(),
  ],
  endpoints: [getProductsByCategory, getProductsByBrand, searchProducts, getBestSellers],
  hooks: {
    afterRead: [populateRelatedProducts],
    afterChange: [autoTranslate],
  },
})
