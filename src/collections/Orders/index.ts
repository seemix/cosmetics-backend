import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'

import { createOrder } from '@/collections/Orders/endpoints/createOrder'
import { setOrderNumber } from '@/collections/Orders/hooks/setOrderNumber'
import { getMyOrders } from '@/collections/Orders/endpoints/getMyOrders'
import { sendNewOrderNotification } from '@/collections/Orders/hooks/sendNewOrderNotification'
import { populatePricesAndTotal } from '@/collections/Orders/hooks/populatePricesAndTotal' // Імпортуємо наш новий хук
import { collectionLabels, label, localized } from '@/i18n'

export const OrdersCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: 'orders',
  labels: collectionLabels('custom:collection:orders:singular', 'custom:collection:orders:plural'),
  admin: {
    useAsTitle: 'createdAt',
    group: localized('custom:group:ecommerce'),
  },
  fields: [
    {
      name: 'orderNumber',
      label: label('custom:field:orderNumber'),
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
      label: label('custom:field:telegramMessageId'),
      type: 'text',
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'customer',
      label: label('custom:field:customer'),
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'items',
      label: label('custom:field:items'),
      type: 'array',
      fields: [
        {
          name: 'product',
          label: label('custom:term:product'),
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
              label: label('custom:term:quantity'),
              type: 'number',
              required: true,
              admin: {
                width: '50%',
              },
            },
            {
              name: 'price',
              label: label('custom:field:price'),
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
      label: label('custom:term:total'),
      type: 'number',
      required: true,
      admin: {
        position: 'sidebar',
        readOnly: true, // Загальну суму теж краще зробити readonly, оскільки вона рахується автоматично
      },
    },
    {
      name: 'status',
      label: label('custom:term:status'),
      type: 'select',
      options: [
        { label: label('custom:status:pending'), value: 'pending' },
        { label: label('custom:status:paid'), value: 'paid' },
        { label: label('custom:status:shipped'), value: 'shipped' },
        { label: label('custom:status:cancelled'), value: 'cancelled' },
      ],
      defaultValue: 'pending',
      admin: { position: 'sidebar' },
    },
    {
      name: 'paymentType',
      label: label('custom:field:paymentType'),
      type: 'select',
      options: [
        { label: label('custom:option:paymentCash'), value: 'cash' },
        { label: label('custom:option:paymentTransfer'), value: 'transfer' },
      ],
    },
    {
      name: 'SRL',
      label: label('custom:field:srl'),
      type: 'text',
    },
    {
      name: 'shippingAddress',
      label: label('custom:field:shippingAddress'),
      type: 'group',
      fields: [
        { name: 'name', label: label('custom:field:fullName'), type: 'text', required: true },
        { name: 'phone', label: label('custom:field:phone'), type: 'text', required: true },
        { name: 'email', label: label('custom:field:email'), type: 'email', required: true },
        { name: 'city', label: label('custom:field:city'), type: 'text', required: true },
        { name: 'address', label: label('custom:field:address'), type: 'text', required: true },
      ],
    },
    { name: 'comment', label: label('custom:term:comment'), type: 'text' },
    { name: 'promoCodeApplied', label: label('custom:field:promoCodeApplied'), type: 'text' },
    { name: 'discount', label: label('custom:field:discount'), type: 'number' },
  ],
  endpoints: [createOrder, getMyOrders],
  hooks: {
    // Додаємо хук перед збереженням замовлення.
    // Важливо: setOrderNumber має виконуватись або до, або після, порядок можна скоригувати за потреби.
    beforeChange: [setOrderNumber, populatePricesAndTotal],
    afterChange: [sendNewOrderNotification],
  },
})