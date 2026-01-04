import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { publicAccess } from '@/access/publicAccess'
import { adminOrSelf } from '@/access/adminOrSelf'
import { checkRole } from '@/access/utilities'

import { ensureFirstUserIsAdmin } from './hooks/ensureFirstUserIsAdmin'

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
     verify: true
    // verify: {
    //   generateEmailHTML: ({ token }) => {
    //     const url = `http://localhost:3000/verify?token=${token}`
    //     console.log('VERIFY LINK:', url)
    //     return `<p>${url}</p>`
    //   },
    // },
    // verify: {
    //   generateEmailHTML: ({ req, token, user }) => {
    //     // Construct your verification URL
    //     const url = `http://localhost:3000/verify/{token}`;
    //     return `<h1>Hello ${user.email},</h1><p>Please verify your account by clicking here: <a href="${url}">Verify</a></p>`;
    //   },
    //   // ... other auth settings
    // },
    // verify: {
    //   generateEmailHTML: ({ token, user }) => {
    //     const url = `http://localhost:3000/api/verify?token=${token}`
    //
    //     return `
    //   <h1>Hello ${user.email}</h1>
    //   <p>Please verify your account:</p>
    //   <a href="${url}">Verify email</a>
    // `
    //   },
    // },
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
      required: true
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
