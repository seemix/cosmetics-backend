import { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { FieldAccess, PayloadRequest, TextFieldValidation } from 'payload'
import { email, text } from 'payload/shared'

import { createOrder } from '@/collections/Orders/endpoints/createOrder'
import { acceptPayment } from '@/collections/Orders/endpoints/acceptPayment'
import { setOrderNumber } from '@/collections/Orders/hooks/setOrderNumber'
import { getMyOrders } from '@/collections/Orders/endpoints/getMyOrders'
import { sendNewOrderNotification } from '@/collections/Orders/hooks/sendNewOrderNotification'
import { assignAccountingFields } from '@/collections/Orders/hooks/assignAccountingFields'
import { deductOrderStock } from '@/collections/Orders/hooks/deductOrderStock'
import { writeOrderStockMoves } from '@/collections/Orders/hooks/writeOrderStockMoves'
import { cancelOrderStock, prepareOrderCancel } from '@/collections/Orders/hooks/cancelOrderStock'
import { forbidDeletePosted } from '@/collections/Orders/hooks/forbidDeletePosted'
import { guardManagerOrderUpdate } from '@/collections/Orders/hooks/guardManagerOrderUpdate'
import { guardPostedOrder } from '@/collections/Orders/hooks/guardPostedOrder'
import { populatePricesAndTotal } from '@/collections/Orders/hooks/populatePricesAndTotal' // Імпортуємо наш новий хук
import { adminOnly } from '@/access/adminOnly'
import { guardSortFields } from '@/hooks/guardSortFields'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { adminOrCustomerOwner } from '@/access/adminOrCustomerOwner'
import { adminOrManager } from '@/access/adminOrManager'
import { adminOrManagerField } from '@/access/adminOrManagerField'
import { checkRole } from '@/access/utilities'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/**
 * Склад, джерело й автор задаються при створенні й далі не змінюються (REST; хук тримає те саме для Local API).
 * Менеджер бачить їх і обирає склад, створюючи замовлення в адмінці (розд. 2.5, 9.3).
 */
const adminCreateOnly = { read: adminOrManagerField, create: adminOrManagerField, update: () => false }

/** Лише admin, manager або власник замовлення: `paidBani`, `paymentState`. */
const adminOrOwnerRead: FieldAccess = ({ req: { user }, doc }) => {
  if (!user) return false
  if (checkRole(['admin', 'manager'], user)) return true
  const customer = doc?.customer
  return String(typeof customer === 'object' && customer ? customer.id : customer) === String(user.id)
}

/** Адреса обов'язкова лише для замовлень сайту; з адмінки (продаж у магазині) вона опційна. */
const isWebOrder = (options: { data?: unknown; req?: { context?: Record<string, unknown> } }) =>
  (options.data as { source?: string } | undefined)?.source === 'web' ||
  options.req?.context?.orderSource === 'web'

const addressText: TextFieldValidation = (value, options) =>
  text(value, { ...options, required: isWebOrder(options) })

const addressEmail = (value: string | null | undefined, options: Parameters<typeof email>[1]) =>
  email(value, { ...options, required: isWebOrder(options) })

export const OrdersCollection: CollectionOverride = ({ defaultCollection }) => ({
  ...defaultCollection,
  slug: 'orders',
  labels: collectionLabels('custom:collection:orders:singular', 'custom:collection:orders:plural'),
  // Розд. 11: manager створює в адмінці й бачить усі; update обмежує `guardManagerOrderUpdate`.
  // Публічний `createOrder` пише через Local API і від цих прав не залежить.
  access: {
    create: adminOrManager,
    read: (args) => adminOrManager(args) || adminOrCustomerOwner(args),
    update: adminOrManager,
    delete: adminOnly,
  },
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
      name: 'acceptPayment',
      type: 'ui',
      admin: {
        components: {
          Field: '@/collections/Orders/components/AcceptPaymentButton#AcceptPaymentButton',
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
              // Для manager лише читання (розд. 9.3, В7); ціну каталогу ставить `populatePricesAndTotal`.
              access: { create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
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
      admin: { condition: (data) => data?.paymentType === 'transfer' },
    },
    {
      name: 'shippingFromCustomer',
      type: 'ui',
      admin: {
        components: {
          Field: '@/collections/Orders/components/ShippingFromCustomer#ShippingFromCustomer',
        },
      },
    },
    {
      name: 'shippingAddress',
      label: label('custom:field:shippingAddress'),
      type: 'group',
      fields: [
        { name: 'name', label: label('custom:field:fullName'), type: 'text', validate: addressText },
        { name: 'phone', label: label('custom:field:phone'), type: 'text', validate: addressText },
        { name: 'email', label: label('custom:field:email'), type: 'email', validate: addressEmail },
        { name: 'city', label: label('custom:field:city'), type: 'text', validate: addressText },
        { name: 'address', label: label('custom:field:address'), type: 'text', validate: addressText },
      ],
    },
    { name: 'comment', label: label('custom:term:comment'), type: 'text' },
    {
      name: 'promoCodeApplied',
      label: label('custom:field:promoCodeApplied'),
      type: 'text',
      // Промокод застосовує лише сайт: у формі створення з адмінки поле не потрібне.
      admin: { condition: (data) => data?.source === 'web' },
    },
    { name: 'discount', label: label('custom:field:discount'), type: 'number' },
    {
      name: 'source',
      label: label('custom:field:source'),
      type: 'select',
      options: [
        { label: label('custom:option:sourceWeb'), value: 'web' },
        { label: label('custom:option:sourceAdmin'), value: 'admin' },
      ],
      access: adminCreateOnly,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'warehouse',
      label: label('custom:term:warehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      index: true,
      // У формі створення підставляємо склад з налаштувань обліку; хук `assignAccountingFields` робить те саме, якщо поле порожнє.
      defaultValue: async ({ req }: { req: PayloadRequest }) => {
        const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
        const warehouse = settings.defaultAdminWarehouse
        return (typeof warehouse === 'object' ? warehouse?.id : warehouse) ?? undefined
      },
      access: adminCreateOnly,
      admin: { position: 'sidebar' },
    },
    {
      name: 'createdBy',
      label: label('custom:field:createdBy'),
      type: 'relationship',
      relationTo: 'users',
      access: adminCreateOnly,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'manager',
      label: label('custom:term:managerSnapshot'),
      type: 'relationship',
      relationTo: 'users',
      access: adminCreateOnly,
      admin: { readOnly: true, position: 'sidebar', description: description('custom:desc:managerSnapshot') },
    },
    {
      name: 'paidBani',
      label: label('custom:field:paidBani'),
      type: 'number',
      defaultValue: 0,
      access: { read: adminOrOwnerRead, create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'paymentState',
      label: label('custom:field:paymentState'),
      type: 'select',
      defaultValue: 'unpaid',
      options: [
        { label: label('custom:option:paymentUnpaid'), value: 'unpaid' },
        { label: label('custom:option:paymentPartial'), value: 'partial' },
        { label: label('custom:option:paymentPaid'), value: 'paid' },
      ],
      access: { read: adminOrOwnerRead, create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'accounting',
      label: label('custom:field:accounting'),
      type: 'group',
      access: { read: adminOnlyFieldAccess, create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
      admin: { readOnly: true },
      fields: [
        { name: 'stockPostedAt', label: label('custom:field:stockPostedAt'), type: 'date', index: true },
        moneyField({ name: 'cogsBani', label: label('custom:field:cogsBani') }),
        moneyField({ name: 'revenueBani', label: label('custom:field:revenueBani') }),
        { name: 'cancelledAt', label: label('custom:field:cancelledAt'), type: 'date' },
      ],
    },
  ],
  indexes: [{ fields: ['manager', 'createdAt'] }],
  endpoints: [createOrder, getMyOrders, acceptPayment],
  hooks: {
    beforeOperation: [guardSortFields],
    // Додаємо хук перед збереженням замовлення.
    // Важливо: setOrderNumber має виконуватись або до, або після, порядок можна скоригувати за потреби.
    beforeChange: [
      guardManagerOrderUpdate,
      setOrderNumber,
      guardPostedOrder,
      prepareOrderCancel,
      populatePricesAndTotal,
      assignAccountingFields,
      deductOrderStock,
    ],
    afterChange: [writeOrderStockMoves, cancelOrderStock, sendNewOrderNotification],
    beforeDelete: [forbidDeletePosted],
  },
})