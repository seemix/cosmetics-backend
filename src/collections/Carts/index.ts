import { priceHook } from '@/collections/Carts/hooks/priceHook'
import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import { getCartByUser } from '@/collections/Carts/endpoints/getCartByUser'
import { updateCartItem } from '@/collections/Carts/endpoints/updateCartItem'
import { addCartItem } from '@/collections/Carts/endpoints/addCartItem'
import { Field } from 'payload'
import { removeCartItem } from '@/collections/Carts/endpoints/removeCartItem'
import { clearCart } from '@/collections/Carts/endpoints/clearCart'
import { getGuestCart } from '@/collections/Carts/endpoints/getGuestCart'
import { mergeCart } from '@/collections/Carts/endpoints/mergeCart'
import { validatePromo } from '@/collections/Carts/endpoints/validatePromo'
import { collectionLabels, label, localized } from '@/i18n'

export const CartsCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  labels: collectionLabels('custom:collection:carts:singular', 'custom:collection:carts:plural'),
  admin: {
    ...defaultCollection.admin,
    group: localized('custom:group:ecommerce'),
  },
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
            label: label('custom:field:price'),
            type: 'number',
          },
          {
            name: 'subtotal',
            label: label('custom:field:subtotal'),
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
  endpoints: [getCartByUser, addCartItem, updateCartItem, removeCartItem, clearCart, getGuestCart, mergeCart, validatePromo],
})
