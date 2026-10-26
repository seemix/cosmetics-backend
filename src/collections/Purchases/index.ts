import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { validateInteger } from '@/collections/Stock/shared'
import { activeSuppliersOnly } from '@/collections/Suppliers'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'
import { documentLifecycle } from '@/services/documents/documentLifecycle'

import { calculateFields } from './hooks/calculateFields'
import { postPurchase, reversePurchase } from './hooks/postPurchase'

const lifecycle = documentLifecycle({
  prefix: 'PUR',
  counterKey: 'purchaseNumber',
  onPost: postPurchase,
  onReverse: reversePurchase,
})

const calculated = { readOnly: true, description: description('custom:desc:calculated') }

/** Приходна накладна, див. docs/accounting/design.md, розд. 2.2, 3.2. */
export const Purchases: CollectionConfig = {
  slug: 'purchases',
  labels: collectionLabels('custom:collection:purchases:singular', 'custom:collection:purchases:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'supplier', 'warehouse', 'landedTotalBani', 'postedAt'],
    listSearchableFields: ['number', 'supplierInvoiceNo'],
    group: localized('custom:group:purchasing'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['supplier', 'status', 'postedAt'] }, { fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    // Спершу розрахунок, потім правила статусів: проведення бачить остаточні суми.
    beforeChange: [calculateFields, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'supplier',
      label: label('custom:term:supplier'),
      type: 'relationship',
      relationTo: 'suppliers',
      required: true,
      index: true,
      filterOptions: activeSuppliersOnly,
    },
    { name: 'supplierInvoiceNo', label: label('custom:field:supplierInvoiceNo'), type: 'text' },
    {
      name: 'warehouse',
      label: label('custom:term:warehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: { isActive: { equals: true } },
    },
    {
      name: 'allocationBase',
      label: label('custom:field:allocationBase'),
      type: 'select',
      required: true,
      defaultValue: 'amount',
      options: [
        { label: label('custom:option:allocAmount'), value: 'amount' },
        { label: label('custom:option:allocQuantity'), value: 'quantity' },
      ],
    },
    {
      name: 'lines',
      label: label('custom:field:lines'),
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
        {
          type: 'row',
          fields: [
            { name: 'quantity', label: label('custom:term:quantity'), type: 'number', required: true, min: 1, validate: validateInteger },
            moneyField({ name: 'unitPriceBani', label: label('custom:term:unitPrice'), required: true, min: 0 }),
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), admin: calculated }),
          ],
        },
        {
          type: 'row',
          fields: [
            moneyField({ name: 'allocatedBani', label: label('custom:field:allocatedBani'), admin: calculated }),
            moneyField({ name: 'landedBani', label: label('custom:field:landedBani'), admin: calculated }),
            {
              name: 'landedUnitCost',
              label: label('custom:field:landedUnitCost'),
              type: 'number',
              admin: { readOnly: true, description: description('custom:desc:fractionalDisplay') },
            },
          ],
        },
      ],
    },
    {
      name: 'extraCosts',
      label: label('custom:field:extraCosts'),
      type: 'array',
      admin: { description: description('custom:desc:extraCosts') },
      fields: [
        { name: 'description', label: label('custom:field:description'), type: 'text', required: true },
        {
          type: 'row',
          fields: [
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
            {
              name: 'payee',
              label: label('custom:field:payee'),
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
        moneyField({ name: 'goodsTotalBani', label: label('custom:field:goodsTotalBani'), admin: calculated }),
        moneyField({ name: 'extraTotalBani', label: label('custom:field:extraTotalBani'), admin: calculated }),
        moneyField({ name: 'landedTotalBani', label: label('custom:field:landedTotalBani'), admin: calculated }),
      ],
    },
  ],
}
