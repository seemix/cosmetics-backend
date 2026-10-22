import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { createOrder } from '@/collections/Orders/endpoints/createOrder'
import { setOrderNumber } from '@/collections/Orders/hooks/setOrderNumber'
import { getMyOrders } from '@/collections/Orders/endpoints/getMyOrders'
import { sendNewOrderNotification } from '@/collections/Orders/hooks/sendNewOrderNotification'
import { populatePricesAndTotal } from '@/collections/Orders/hooks/populatePricesAndTotal' // Імпортуємо наш новий хук

export const OrdersCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: 'orders',
  admin: {
    useAsTitle: 'createdAt',
    group: 'Ecommerce',
  },
  fields: [
    {
      name: 'orderNumber',
      type: 'text',
      unique: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'orderLogic',
      type: 'ui',
      admin: {
        components: {
          Field: '@/collections/Orders/components/OrderManager#OrderManager',
        },
      },
    },
    {
      name: 'telegramMessageId',
      type: 'text',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'items',
      type: 'array',
      fields: [
        {
          name: 'product',
          type: 'relationship',
          relationTo: 'products',
          required: true,
          admin: {
            sortOptions: 'title',
            allowCreate: false,
          },
        },
        {
          type: 'row',
          fields: [
            {
              name: 'quantity',
              type: 'number',
              required: true,
              admin: {
                width: '50%',
              },
            },
            {
              name: 'price',
              type: 'number',
              required: true,
              admin: {
                components: {
                  Field: '@/collections/Orders/components/PriceField#PriceField',
                },
                width: '50%',
                // За бажанням можна увімкнути readOnly, щоб ціну не редагували вручну:
                // readOnly: true,
              },

            },
          ],
        },
      ],
    },
    {
      name: 'total',
      type: 'number',
      required: true,
      admin: {
        position: 'sidebar',
        readOnly: true, // Загальну суму теж краще зробити readonly, оскільки вона рахується автоматично
      },
    },
    {
      name: 'status',
      type: 'select',
      options: ['pending', 'paid', 'shipped', 'cancelled'],
      defaultValue: 'pending',
      admin: { position: 'sidebar' },
    },
    {
      name: 'paymentType',
      type: 'select',
      options: ['cash', 'transfer'],
    },
    {
      name: 'SRL',
      type: 'text',
    },
    {
      name: 'shippingAddress',
      type: 'group',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'phone', type: 'text', required: true },
        { name: 'email', type: 'email', required: true },
        { name: 'city', type: 'text', required: true },
        { name: 'address', type: 'text', required: true },
      ],
    },
    { name: 'comment', type: 'text' },
    { name: 'promoCodeApplied', type: 'text' },
    { name: 'discount', type: 'number' },
  ],
  endpoints: [createOrder, getMyOrders],
  hooks: {
    // Додаємо хук перед збереженням замовлення.
    // Важливо: setOrderNumber має виконуватись або до, або після, порядок можна скоригувати за потреби.
    beforeChange: [setOrderNumber, populatePricesAndTotal],
    afterChange: [sendNewOrderNotification],
  },
})