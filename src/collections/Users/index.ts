import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { publicAccess } from '@/access/publicAccess'
import { adminOrSelf } from '@/access/adminOrSelf'
import { checkRole } from '@/access/utilities'

import { ensureFirstUserIsAdmin } from './hooks/ensureFirstUserIsAdmin'
import { emailHeader } from '@/email-templates/email-header'
import { verifyEmail } from '@/email-templates/verify-email'
import { emailFooter } from '@/email-templates/email-footer'
import { forgotPassword } from '@/email-templates/forgot-password'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: ({ req: { user } }) => checkRole(['admin'], user),
    create: publicAccess,
    delete: adminOnly,
    read: adminOrSelf,
    update: adminOrSelf,

  },
  admin: {
    group: 'Users',
    defaultColumns: ['name', 'email', 'roles'],
    useAsTitle: 'name',
  },
  auth: {
    depth: 3,
    tokenExpiration: 1209600,
    useSessions: false,
    verify: {
      generateEmailHTML: ({ token, user }) => {
        const url = `${process.env.FRONTEND_URL}/verify-email/${token}`
        return `${emailHeader}${verifyEmail(user.locale, user.name, url)}${emailFooter}`
      },
    },
    forgotPassword: {
      generateEmailHTML: (args) => {
        const token = args?.token
        const user = args?.user

        if (!token || !user) {
          return ''
        }
        const url = `${process.env.FRONTEND_URL}/reset-password/${token}`
        return `${emailHeader}${forgotPassword(user.locale, user.name, url)}${emailFooter}`
      },
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'email',
      type: 'email',
      unique: true,
      required: true,
    },
    {
      name: 'wholesale',
      type: 'checkbox',
      label: 'WholeSale',
      defaultValue: false,
    },
    {
      name: 'surname',
      type: 'text',
      required: true,
    },
    {
      name: 'phone',
      type: 'text',
      required: true,
    },
    {
      name: 'locale',
      type: 'select',
      options: ['ru', 'ro'],
      defaultValue: 'ru',
    },
    {
      name: 'address',
      type: 'text',
    },
    {
      name: 'barbershop',
      type: 'text',
    },
    {
      name: 'roles',
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
          label: 'admin',
          value: 'admin',
        },
        {
          label: 'customer',
          value: 'customer',
        },
      ],
    },
    {
      name: 'orders',
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
      type: 'join',
      collection: 'addresses',
      on: 'customer',
      admin: {
        allowCreate: false,
        defaultColumns: ['id'],
      },
    },
  ],
}
