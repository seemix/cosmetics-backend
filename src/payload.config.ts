// storage-adapter-import-placeholder
import { mongooseAdapter } from '@payloadcms/db-mongodb'
//import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { resendAdapter } from '@payloadcms/email-resend'

import {
  BoldFeature,
  EXPERIMENTAL_TableFeature,
  IndentFeature,
  ItalicFeature,
  LinkFeature,
  OrderedListFeature,
  UnderlineFeature,
  UnorderedListFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Categories } from '@/collections/Categories'
import { Media } from '@/collections/Media'
import { Pages } from '@/collections/Pages'
import { Brands } from '@/collections/Brands'
import { PromoCodes } from './collections/PromoCodes'
import { Users } from '@/collections/Users'
import { Posts } from './collections/Posts'
import { Warehouses } from './collections/Warehouses'
import { Suppliers } from './collections/Suppliers'
import { StockMoves } from './collections/Stock/StockMoves'
import { StockBalances } from './collections/Stock/StockBalances'
import { ProductCosts } from './collections/Stock/ProductCosts'
import { Purchases } from './collections/Purchases'
import { StockTransfers } from './collections/StockTransfers'
import { StockAdjustments } from './collections/StockAdjustments'
import { OpeningBalances } from './collections/OpeningBalances'
import { AccountingSettings } from './globals/AccountingSettings'
import { plugins } from './plugins'
import { getMenu } from '@/endpoints/getMenu'
import { stockCacheCheck, stockCacheRebuild } from '@/endpoints/stockCacheCheck'
import sharp from 'sharp'
import payloadSidebar from 'payload-sidebar-plugin'


const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({

  cors: [
    process.env.FRONTEND_URL || 'https://nextlevelshop.md',
    process.env.BACKEND_URL || 'https://admin.nextlevelshop.md',
  ],
  csrf: [
    process.env.FRONTEND_URL || 'https://nextlevelshop.md',
    process.env.BACKEND_URL || 'https://admin.nextlevelshop.md',
  ],
  sharp,
  localization: {
    locales: [{ label: 'Русский', code: 'ru' }, { label: 'Română', code: 'ro' }],
    defaultLocale: 'ru',
    fallback: true,
  },
  routes: {
    admin: '/',
  },
  cookiePrefix: 'payload',
  auth: {
    jwtOrder: ['cookie', 'Bearer'],
  },

  admin: {
    meta: {
      titleSuffix: 'Admin Dashboard',
      title: 'Next Level Shop |',
      icons: [
        {
          rel: 'icon',
          type: 'image/png',
          url: '/favicon.png',
        },
      ],
    },
    components: {
      // The `BeforeLogin` component renders a message that you see while logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeLogin` statement on line 15.
      graphics: {
        Logo: '@/assets/CustomLogo.tsx',
        Icon: '@/assets/CustomLogo.tsx',
      },
      beforeLogin: ['@/components/BeforeLogin#BeforeLogin'],

      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeDashboard` statement on line 15.
      // beforeDashboard: ['@/components/BeforeDashboard#BeforeDashboard'],
    },
    user: Users.slug,
  },
  collections: [Users, Pages, Posts, Categories, Brands, Media, PromoCodes, Warehouses, Suppliers, StockMoves, StockBalances, ProductCosts, Purchases, StockTransfers, StockAdjustments, OpeningBalances],
  db: mongooseAdapter({
    url: process.env.DATABASE_URI || '',
  }),
  editor: lexicalEditor({
    features: () => {
      return [
        UnderlineFeature(),
        BoldFeature(),
        ItalicFeature(),
        OrderedListFeature(),
        UnorderedListFeature(),
        LinkFeature({
          enabledCollections: ['pages'],
          fields: ({ defaultFields }) => {
            const defaultFieldsWithoutUrl = defaultFields.filter((field) => {
              return !('name' in field && field.name === 'url')

            })

            return [
              ...defaultFieldsWithoutUrl,
              {
                name: 'url',
                type: 'text',
                admin: {
                  condition: ({ linkType }) => linkType !== 'internal',
                },
                label: ({ t }) => t('fields:enterURL'),
                required: true,
              },
            ]
          },
        }),
        IndentFeature(),
        EXPERIMENTAL_TableFeature(),
      ]
    },
  }),
  // Без RESEND_API_KEY Payload бере консольний транспорт: листи пишуться в лог,
  // а при старті з'являється попередження "No email adapter provided".
  email: process.env.RESEND_API_KEY
    ? resendAdapter({
        defaultFromAddress: 'noreply@nextlevelshop.md',
        defaultFromName: 'Next Level Shop',
        apiKey: process.env.RESEND_API_KEY,
      })
    : undefined,
  endpoints: [getMenu, stockCacheCheck, stockCacheRebuild],
  //globals: [Header, Footer],
  globals: [AccountingSettings],
  plugins: [
    ...plugins,
    payloadSidebar({
      icons: {
        posts: 'file-code',
        brands: 'award',
        carts: 'shopping-cart',
        'promo-codes': 'tag',
        transactions: 'credit-card',
        products: 'package',
        orders: 'clipboard-list',
        users: 'users',
        warehouses: 'warehouse',
        suppliers: 'truck',
        'stock-moves': 'history',
        'stock-balances': 'boxes',
        'product-costs': 'coins',
        purchases: 'receipt',
        'stock-transfers': 'arrow-left-right',
        'stock-adjustments': 'clipboard-check',
        'opening-balances': 'package-plus',
        'accounting-settings': 'settings',
      },
    }),
    // storage-adapter-placeholder
  ],
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Sharp is now an optional dependency -
  // if you want to resize images, crop, set focal point, etc.
  // make sure to install it and pass it to the config.
  // sharp,
})
