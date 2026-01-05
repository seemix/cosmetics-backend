import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { publicAccess } from '@/access/publicAccess'
import { adminOrSelf } from '@/access/adminOrSelf'
import { checkRole } from '@/access/utilities'
import { render } from '@react-email/render'
import { VerifyEmail } from '@/email-templates/VerifyEmail'

import { ensureFirstUserIsAdmin } from './hooks/ensureFirstUserIsAdmin'
import React from 'react'
import { emailHeader } from '@/email-templates/email-header'
import { verifyEmail } from '@/email-templates/verify-email'
import { emailFooter } from '@/email-templates/email-footer'

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
    tokenExpiration: 1209600,
   // verify: true,
    verify: {
      generateEmailHTML: ({ token, user }) => {
        const url = `${process.env.FRONTEND_URL}/verify/${token}`
        return `${emailHeader}${verifyEmail(user.locale, user.name, url)}${emailFooter}`
        // return `
        //   <!doctype html>
        //   <html>
        //     <body>
        //       <h1 style="font-family: 'Helvetica Neue', helvetica, arial, sans-serif; font-size: 25px;">
        //       Here is my custom email template!
        //       </h1>
        //       <p style="font-size: 14px; font-family: 'Helvetica Neue', helvetica, arial, sans-serif">
        //       Hello, ${user.email}!
        //       </p>
        //       <p>Click below to activate your account</p>
        //       <p>
        //         <a href="${url}">${url}</a>
        //       </p>
        //     </body>
        //   </html>
        // `
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
