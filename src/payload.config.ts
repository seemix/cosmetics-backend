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
import { CashAccounts } from './collections/Finance/CashAccounts'
import { CashMoves } from './collections/Finance/CashMoves'
import { CustomerBalances } from './collections/Finance/CustomerBalances'
import { CustomerMoves } from './collections/Finance/CustomerMoves'
import { CashOperations } from './collections/Finance/CashOperations'
import { ExpenseCategories } from './collections/Finance/ExpenseCategories'
import { SalarySchemes } from './collections/Salary/SalarySchemes'
import { Payrolls } from './collections/Salary/Payrolls'
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
import { cashCacheCheck, cashCacheRebuild } from '@/endpoints/cashCacheCheck'
import { stockCacheCheck, stockCacheRebuild } from '@/endpoints/stockCacheCheck'
import { getProductStock } from '@/endpoints/getProductStock'
import { reportEndpoints } from '@/endpoints/reports'
import sharp from 'sharp'
import payloadSidebar from 'payload-sidebar-plugin'
import { en } from '@payloadcms/translations/languages/en'
import { ro } from '@payloadcms/translations/languages/ro'
import { ru } from '@payloadcms/translations/languages/ru'
import { customTranslations, localized } from '@/i18n'


const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Порядок груп бічного меню: плагін порівнює за підписом групи, тож задаємо його для кожної мови.
const sidebarGroupOrder: Record<string, number> = {}
;(['ecommerce', 'stock', 'purchasing', 'finance', 'users', 'content'] as const).forEach((group, index) => {
  for (const text of Object.values(localized(`custom:group:${group}`))) sidebarGroupOrder[text] = index + 1
})

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
  // Мова ІНТЕРФЕЙСУ адмінки (перемикається в профілі). Мови контенту товарів нижче в localization.
  i18n: {
    supportedLanguages: { en, ru, ro },
    fallbackLanguage: 'en',
    translations: customTranslations,
  },
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
      // Посилання «Звіти» (лише admin) і сама сторінка `/admin/reports`.
      afterNavLinks: ['@/components/ReportsView/ReportsNavLink#ReportsNavLink'],
      views: {
        reports: {
          Component: '@/components/ReportsView#ReportsPage',
          path: '/reports',
        },
      },

      // The `BeforeDashboard` component renders the 'welcome' block that you see after logging into your admin panel.
      // Feel free to delete this at any time. Simply remove the line below and the import `BeforeDashboard` statement on line 15.
      // beforeDashboard: ['@/components/BeforeDashboard#BeforeDashboard'],
    },
    user: Users.slug,
  },
  collections: [Users, Pages, Posts, Categories, Brands, Media, PromoCodes, Warehouses, Suppliers, StockMoves, StockBalances, ProductCosts, Purchases, StockTransfers, StockAdjustments, OpeningBalances, CashAccounts, ExpenseCategories, CashMoves, CashOperations, CustomerBalances, CustomerMoves, SalarySchemes, Payrolls],
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
  endpoints: [getMenu, stockCacheCheck, stockCacheRebuild, cashCacheCheck, cashCacheRebuild, getProductStock, ...reportEndpoints],
  //globals: [Header, Footer],
  globals: [AccountingSettings],
  plugins: [
    ...plugins,
    payloadSidebar({
      groupOrder: sidebarGroupOrder,
      icons: {
        posts: 'file-code',
        brands: 'award',
        carts: 'shopping-cart',
        'promo-codes': 'tag',
        transactions: 'credit-card',
        products: 'package',
        orders: 'clipboard-list',
        users: 'users',
        warehouses: 'building-2',
        suppliers: 'handshake',
        'stock-moves': 'activity',
        'stock-balances': 'bar-chart-3',
        'product-costs': 'dollar-sign',
        purchases: 'receipt',
        'stock-transfers': 'arrow-right',
        'stock-adjustments': 'clipboard-check',
        'opening-balances': 'bookmark',
        'cash-accounts': 'building',
        'expense-categories': 'list-checks',
        'cash-moves': 'send',
        'cash-operations': 'credit-card',
        'salary-schemes': 'file-pen',
        payrolls: 'user-check',
        'accounting-settings': 'sliders-horizontal',
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
