import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { adminOrSelf } from '@/access/adminOrSelf'
import { publicAccess } from '@/access/publicAccess'
import { checkRole } from '@/access/utilities'
import { collectionLabels, description, label, localized } from '@/i18n'

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

export const Users: CollectionConfig = {
  slug: 'users',
  labels: collectionLabels('custom:collection:users:singular', 'custom:collection:users:plural'),
  access: {
    admin: ({ req: { user } }) => checkRole(['admin'], user),
    create: publicAccess,
    delete: adminOnly,
    read: adminOrSelf,
    update: adminOrSelf,

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
      name: 'favorites',
      label: label('custom:field:favorites'),
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
    },

  ],
  endpoints: [addFavoritesItem, getMyFavorites, getFavorites, removeFavoritesItem, updateUserInfo],
}
