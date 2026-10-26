import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { codeOnlyAccess } from '@/collections/Stock/shared'
import { moneyField } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/**
 * Журнал розрахунків з клієнтами: лише доповнюється кодом `customerBalance.service`, див.
 * docs/accounting/design.md, розд. 6.4. Σ `advanceDeltaBani` по клієнту = аванс, Σ `orderDeltaBani`
 * по замовленню = `orders.paidBani`.
 */
export const CustomerMoves: CollectionConfig = {
  slug: 'customer-moves',
  labels: collectionLabels('custom:collection:customerMoves:singular', 'custom:collection:customerMoves:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['date', 'customer', 'kind', 'advanceDeltaBani', 'order', 'orderDeltaBani', 'docNumber'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-date',
  indexes: [{ fields: ['customer', 'date'] }, { fields: ['order', 'date'] }, { fields: ['docCollection', 'docId'] }],
  fields: [
    { name: 'date', label: label('custom:term:date'), type: 'date', required: true, index: true },
    { name: 'customer', label: label('custom:field:customer'), type: 'relationship', relationTo: 'users' },
    {
      name: 'kind',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      options: [
        { label: label('custom:option:customerMoveReceipt'), value: 'receipt' },
        { label: label('custom:option:customerMoveRefund'), value: 'refund' },
        { label: label('custom:option:customerMoveOpening'), value: 'opening' },
        { label: label('custom:option:customerMoveAllocation'), value: 'allocation' },
        { label: label('custom:option:customerMoveRelease'), value: 'release' },
        { label: label('custom:option:customerMoveReversal'), value: 'reversal' },
      ],
    },
    moneyField({
      name: 'advanceDeltaBani',
      label: label('custom:field:advanceDeltaBani'),
      required: true,
      defaultValue: 0,
      admin: { description: description('custom:desc:advanceDelta') },
    }),
    { name: 'order', label: label('custom:field:order'), type: 'relationship', relationTo: 'orders' },
    moneyField({
      name: 'orderDeltaBani',
      label: label('custom:field:orderDeltaBani'),
      required: true,
      defaultValue: 0,
      admin: { description: description('custom:desc:orderPaidDelta') },
    }),
    { name: 'docCollection', label: label('custom:field:docCollection'), type: 'text', required: true },
    { name: 'docId', label: label('custom:field:docId'), type: 'text', required: true },
    { name: 'docNumber', label: label('custom:field:docNumber'), type: 'text' },
  ],
}
