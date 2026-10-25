import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { validateInteger } from '@/collections/Stock/shared'
import { activeSuppliersOnly } from '@/collections/Suppliers'
import { moneyField } from '@/fields/money'
import { documentLifecycle } from '@/services/documents/documentLifecycle'

import { calculateFields } from './hooks/calculateFields'
import { postPurchase, reversePurchase } from './hooks/postPurchase'
import { startTransaction } from './hooks/startTransaction'

const lifecycle = documentLifecycle({ prefix: 'PUR', onPost: postPurchase, onReverse: reversePurchase })

const calculated = { readOnly: true, description: 'Calculated' }

/** Приходна накладна, див. docs/accounting/design.md, розд. 2.2, 3.2. */
export const Purchases: CollectionConfig = {
  slug: 'purchases',
  labels: { singular: 'Purchase', plural: 'Purchases' },
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'supplier', 'warehouse', 'landedTotalBani', 'postedAt'],
    listSearchableFields: ['number', 'supplierInvoiceNo'],
    group: 'Purchasing',
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['supplier', 'status', 'postedAt'] }, { fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: [startTransaction],
    // Спершу розрахунок, потім правила статусів: проведення бачить остаточні суми.
    beforeChange: [calculateFields, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'supplier',
      label: 'Supplier',
      type: 'relationship',
      relationTo: 'suppliers',
      required: true,
      index: true,
      filterOptions: activeSuppliersOnly,
    },
    { name: 'supplierInvoiceNo', label: 'Supplier invoice no.', type: 'text' },
    {
      name: 'warehouse',
      label: 'Warehouse',
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: { isActive: { equals: true } },
    },
    {
      name: 'allocationBase',
      label: 'Allocate extra costs by',
      type: 'select',
      required: true,
      defaultValue: 'amount',
      options: [
        { label: 'Line amount', value: 'amount' },
        { label: 'Quantity', value: 'quantity' },
      ],
    },
    {
      name: 'lines',
      label: 'Lines',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'product', label: 'Product', type: 'relationship', relationTo: 'products', required: true },
        {
          type: 'row',
          fields: [
            { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, validate: validateInteger },
            moneyField({ name: 'unitPriceBani', label: 'Unit price', required: true, min: 0 }),
            moneyField({ name: 'amountBani', label: 'Amount', admin: calculated }),
          ],
        },
        {
          type: 'row',
          fields: [
            moneyField({ name: 'allocatedBani', label: 'Allocated extra costs', admin: calculated }),
            moneyField({ name: 'landedBani', label: 'Landed amount', admin: calculated }),
            {
              name: 'landedUnitCost',
              label: 'Landed unit cost, bani',
              type: 'number',
              admin: { readOnly: true, description: 'Fractional, display only' },
            },
          ],
        },
      ],
    },
    {
      name: 'extraCosts',
      label: 'Extra costs',
      type: 'array',
      admin: { description: 'Logistics, customs, packaging' },
      fields: [
        { name: 'description', label: 'Description', type: 'text', required: true },
        {
          type: 'row',
          fields: [
            moneyField({ name: 'amountBani', label: 'Amount', required: true, min: 1 }),
            {
              name: 'payee',
              label: 'Payee',
              type: 'relationship',
              relationTo: 'suppliers',
              required: true,
              filterOptions: activeSuppliersOnly,
            },
          ],
        },
      ],
    },
    {
      type: 'row',
      fields: [
        moneyField({ name: 'goodsTotalBani', label: 'Goods total', admin: calculated }),
        moneyField({ name: 'extraTotalBani', label: 'Extra costs total', admin: calculated }),
        moneyField({ name: 'landedTotalBani', label: 'Landed total', admin: calculated }),
      ],
    },
  ],
}
