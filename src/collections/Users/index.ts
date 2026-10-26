import type { Access, CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { adminOrManagerField } from '@/access/adminOrManagerField'
import { adminOrSelf } from '@/access/adminOrSelf'
import { isManager } from '@/access/isAdmin'
import { publicAccess } from '@/access/publicAccess'
import { checkRole } from '@/access/utilities'
import { guardSortFields } from '@/hooks/guardSortFields'
import { collectionLabels, customT, description, label, localized } from '@/i18n'

import { addFavoritesItem } from '@/collections/Users/endpoints/addFavoritesItem'
import { getMyFavorites } from '@/collections/Users/endpoints/getMyFavorites'
import { removeFavoritesItem } from '@/collections/Users/endpoints/removeFavoritesItem'
import { updateUserInfo } from '@/collections/Users/endpoints/updateUserInfo'
import { emailFooter } from '@/email-templates/email-footer'
import { emailHeader } from '@/email-templates/email-header'
import { emailSubject } from '@/email-templates/email-subject'
import { forgotPassword } from '@/email-templates/forgot-password'
import { verifyEmail } from '@/email-templates/verify-email'
import { getFavorites } from './endpoints/getFavorites'
import { ensureFirstUserIsAdmin } from './hooks/ensureFirstUserIsAdmin'
import { assignCustomerManager } from './hooks/assignCustomerManager'

/** Manager бачить себе й клієнтів: роль `customer` без ролей `admin` і `manager` (розд. 11). */
const readUsers: Access = (args) => {
  if (!isManager(args.req.user)) return adminOrSelf(args)

  return {
    or: [
      { id: { equals: args.req.user?.id } },
      { and: [{ roles: { equals: 'customer' } }, { roles: { not_in: ['admin', 'manager'] } }] },
    ],
  }
}

export const Users: CollectionConfig = {
  slug: 'users',
  labels: collectionLabels('custom:collection:users:singular', 'custom:collection:users:plural'),
  access: {
    admin: ({ req: { user } }) => checkRole(['admin', 'manager'], user),
    create: publicAccess,
    delete: adminOnly,
    read: readUsers,
    update: adminOrSelf,
    // Без правила діяв дефолт «будь-який авторизований»: customer знімав блокування чужих акаунтів.
    unlock: adminOnly,

  },
  admin: {
    group: localized('custom:group:users'),
    defaultColumns: ['name', 'email', 'roles'],
    useAsTitle: 'name',
  },
  auth: {
    cookies: { domain: '.nextlevelshop.md', secure: true, sameSite: 'Lax' },
    depth: 3,
    tokenExpiration: 1209600,
    useSessions: false,
    verify: {
      generateEmailSubject: ({ user }) => {
        const locale = (user?.locale as 'ru' | 'ro') || 'ru'
        return emailSubject('verifyEmail', locale)
      },
      generateEmailHTML: ({ token, user }) => {
        const locale = (user?.locale as 'ru' | 'ro') || 'ru'
        const url = `${process.env.FRONTEND_URL}/${locale}/verify-email/${token}`
        return `${emailHeader}${verifyEmail(user.locale, user.name, url)}${emailFooter}`
      },
    },
    forgotPassword: {
      generateEmailSubject: (args) => emailSubject('forgotPassword', args?.user?.locale as 'ru' | 'ro'),
      generateEmailHTML: (args) => {
        const token = args?.token
        const user = args?.user

        if (!token || !user) {
          return ''
        }
        const locale = args?.user?.locale || 'ru'
        const url = `${process.env.FRONTEND_URL}/${locale}/reset-password/${token}`
        return `${emailHeader}${forgotPassword(user.locale, user.name, url)}${emailFooter}`
      },
    },
  },
  fields: [
    {
      name: 'name',
      label: label('custom:field:name'),
      type: 'text',
    },
    {
      name: 'email',
      label: label('custom:field:email'),
      type: 'email',
      unique: true,
      required: true,
    },
    {
      name: 'wholesale',
      type: 'checkbox',
      label: label('custom:field:wholesaleCustomer'),
      defaultValue: false,
      // Розд. 11: оптовий статус і знижки задає лише admin (не manager і не сам клієнт).
      access: { create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
    },
    {
      name: 'surname',
      label: label('custom:field:surname'),
      type: 'text',
      required: true,
    },
    {
      name: 'phone',
      label: label('custom:field:phone'),
      type: 'text',
      required: true,
    },
    {
      name: 'locale',
      label: label('custom:field:locale'),
      type: 'select',
      options: [
        { label: label('custom:option:localeRu'), value: 'ru' },
        { label: label('custom:option:localeRo'), value: 'ro' },
      ],
      defaultValue: 'ru',
    },
    {
      name: 'city',
      label: label('custom:field:city'),
      type: 'text',
    },
    {
      name: 'street',
      label: label('custom:field:street'),
      type: 'text',
    },
    {
      name: 'brandDiscounts',
      label: label('custom:field:brandDiscounts'),
      type: 'array',
      // Розд. 11: оптовий статус і знижки задає лише admin (не manager і не сам клієнт).
      access: { create: adminOnlyFieldAccess, update: adminOnlyFieldAccess },
      admin: {
        description: description('custom:desc:personalDiscounts'),
      },
      fields: [
        {
          name: 'brand',
          label: label('custom:field:brand'),
          type: 'relationship',
          relationTo: 'brands',
          required: true,
        },
        {
          name: 'discountPercent',
          label: label('custom:field:discountPercent'),
          type: 'number',
          required: true,
          min: 5,
          max: 50,
        },
      ],
    },
    {
      name: 'roles',
      label: label('custom:field:roles'),
      type: 'select',
      access: {
        create: adminOnlyFieldAccess,
        read: adminOnlyFieldAccess,
        update: adminOnlyFieldAccess,
      },
      defaultValue: ['customer'],
      hasMany: true,
      hooks: {
        beforeChange: [ensureFirstUserIsAdmin],
      },
      options: [
        {
          label: label('custom:option:roleAdmin'),
          value: 'admin',
        },
        {
          label: label('custom:option:roleCustomer'),
          value: 'customer',
        },
        {
          label: label('custom:option:roleManager'),
          value: 'manager',
        },
      ],
    },
    {
      name: 'orders',
      label: label('custom:field:orders'),
      type: 'join',
      collection: 'orders',
      on: 'customer',
      admin: {
        allowCreate: false,
        defaultColumns: ['id', 'createdAt', 'total', 'currency', 'items'],
      },
    },
    {
      name: 'cart',
      label: label('custom:field:cart'),
      type: 'join',
      collection: 'carts',
      on: 'customer',
      admin: {
        allowCreate: false,
        defaultColumns: ['id', 'createdAt', 'total', 'currency', 'items'],
      },
    },
    {
      name: 'addresses',
      label: label('custom:field:addresses'),
      type: 'join',
      collection: 'addresses',
      on: 'customer',
      admin: {
        allowCreate: false,
        defaultColumns: ['id'],
      },

    },
    {
      name: 'manager',
      label: label('custom:term:assignedManager'),
      type: 'relationship',
      relationTo: 'users',
      hasMany: false,
      index: true,
      filterOptions: { roles: { contains: 'manager' } },
      access: { read: adminOrManagerField, create: adminOrManagerField, update: adminOnlyFieldAccess },
      admin: { description: description('custom:desc:assignedManager'), position: 'sidebar' },
      // filterOptions не захищає API: роль менеджера перевіряємо на сервері.
      validate: async (value, { req, previousValue }) => {
        const idOf = (v: unknown) => (v && typeof v === 'object' ? (v as { id?: unknown }).id : v)
        const id = idOf(value)
        if (id === null || id === undefined || id === '') return true
        // Незмінене значення не перевіряємо: колишній менеджер міг втратити роль, а клієнт має зберігатися.
        if (previousValue !== undefined && String(idOf(previousValue)) === String(id)) return true

        const manager = await req.payload
          .findByID({ collection: 'users', id: id as string | number, depth: 0, overrideAccess: true, req })
          .catch(() => null)

        return manager && checkRole(['manager'], manager) ? true : customT(req.t)('custom:error:customerManagerInvalid')
      },
    },
    {
      name: 'favorites',
      label: label('custom:field:favorites'),
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
    },

  ],
  endpoints: [addFavoritesItem, getMyFavorites, getFavorites, removeFavoritesItem, updateUserInfo],
  hooks: { beforeOperation: [guardSortFields], beforeChange: [assignCustomerManager] },
}
