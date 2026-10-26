import { seoPlugin } from '@payloadcms/plugin-seo'
import { Plugin } from 'payload'
import { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { ecommercePlugin } from '@payloadcms/plugin-ecommerce'


import { Page, Product } from '@/payload-types'
import { getServerSideURL } from '@/utilities/getURL'
import { ProductsCollection } from '@/collections/Products'
import { adminOrCustomerOwner } from '@/access/adminOrCustomerOwner'
import { adminOrPublishedStatus } from '@/access/adminOrPublishedStatus'
import { adminOnly } from '@/access/adminOnly'
import { adminOnlyFieldAccess } from '@/access/adminOnlyFieldAccess'
import { customerOnlyFieldAccess } from '@/access/customerOnlyFieldAccess'
import { CartsCollection } from '@/collections/Carts'
import { OrdersCollection } from '@/collections/Orders'
import {
  TransactionsCollection,
  VariantOptionsCollection,
  VariantsCollection,
  VariantTypesCollection,
} from '@/collections/pluginCollections'

const generateTitle: GenerateTitle<Product | Page> = ({ doc }) => {
  return doc?.title ? `${doc.title} | Payload Ecommerce Template` : 'Payload Ecommerce Template'
}

const generateURL: GenerateURL<Product | Page> = ({ doc }) => {
  const url = getServerSideURL()

  return doc?.slug ? `${url}/${doc.slug}` : url
}

export const plugins: Plugin[] = [
  seoPlugin({
    generateTitle,
    generateURL,
  }),
  ecommercePlugin({
    access: {
      adminOnly,
      adminOnlyFieldAccess,
      adminOrCustomerOwner,
      adminOrPublishedStatus,
      customerOnlyFieldAccess,
    },
    customers: {
      slug: 'users',
    },
    currencies: {
      defaultCurrency: 'MDL',
      supportedCurrencies: [{
        label: 'MDL',
        decimals: 0,
        code: 'MDL',
        symbol: 'L',
      }],
    },
    // payments: {
    //   paymentMethods: [
    //     stripeAdapter({
    //       secretKey: process.env.STRIPE_SECRET_KEY!,
    //       publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    //       webhookSecret: process.env.STRIPE_WEBHOOKS_SIGNING_SECRET!,
    //     }),
    //   ],
    // },
    products: {
      productsCollectionOverride: ProductsCollection,
      variants: {
        variantsCollectionOverride: VariantsCollection,
        variantTypesCollectionOverride: VariantTypesCollection,
        variantOptionsCollectionOverride: VariantOptionsCollection,
      },
    },
    carts: {
      cartsCollectionOverride: CartsCollection,
    },
    orders: {
      ordersCollectionOverride: OrdersCollection,
    },
    transactions: {
      transactionsCollectionOverride: TransactionsCollection,
    },
  }),
]
