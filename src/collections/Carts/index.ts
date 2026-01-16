import { priceHook } from '@/collections/Carts/hooks/priceHook'
import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import { getCartByUser } from '@/endpoints/getCartByUser'
import { updateCartItem } from '@/collections/Carts/endpoints/updateCartItem'
import { addCartItem } from '@/collections/Carts/endpoints/addCartItem'
import { Field } from 'payload'
import { removeCartItem } from '@/collections/Carts/endpoints/removeCartItem'
import { clearCart } from '@/collections/Carts/endpoints/clearCart'
import { getGuestCart } from '@/collections/Carts/endpoints/getGuestCart'

export const CartsCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  fields: defaultCollection.fields.map((field: Field) => {
    if (
      field.type === 'array' &&
      'name' in field &&
      field.name === 'items'
    ) {
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
  endpoints: [getCartByUser, addCartItem, updateCartItem, removeCartItem, clearCart, getGuestCart],
})
