import { priceHook } from '@/collections/Carts/hooks/priceHook'
import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import { getCartByUser } from '@/endpoints/getCartByUser'

export const CartsCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  fields: defaultCollection.fields.map((field) => {
    if (field.name === 'items' && field.type === 'array') {
      return {
        ...field,
        fields: [
          ...field.fields,
          {
            name: 'price',
            type: 'number',
          },
          {
            name: 'subtotal',
            type: 'number',
          },
        ],
      }
    }
    return field
  }),
  hooks: {
    ...defaultCollection.hooks,
    beforeChange: [
      ...(defaultCollection.hooks?.beforeChange || []),
      priceHook,
    ],
  },
  endpoints: [getCartByUser]
})
