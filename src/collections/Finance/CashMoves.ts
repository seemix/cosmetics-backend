import type { CollectionConfig } from 'payload'

import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { codeOnlyAccess } from '@/collections/Stock/shared'
import { validateBani } from '@/fields/money'
import { collectionLabels, description, label, localized } from '@/i18n'

/** Журнал руху коштів: лише доповнюється кодом `cashLedger`, див. docs/accounting/design.md, розд. 2.4. */
export const CashMoves: CollectionConfig = {
  slug: 'cash-moves',
  labels: collectionLabels('custom:collection:cashMoves:singular', 'custom:collection:cashMoves:plural'),
  access: codeOnlyAccess,
  admin: {
    hidden: hiddenUnlessAdmin,
    defaultColumns: ['date', 'account', 'deltaBani', 'docNumber'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-date',
  indexes: [{ fields: ['account', 'date'] }, { fields: ['docCollection', 'docId'] }],
  fields: [
    { name: 'date', label: label('custom:term:date'), type: 'date', required: true, index: true },
    { name: 'account', label: label('custom:term:cashAccount'), type: 'relationship', relationTo: 'cash-accounts', required: true },
    {
      name: 'deltaBani',
      label: label('custom:field:deltaBani'),
      type: 'number',
      required: true,
      validate: validateBani,
      admin: { description: description('custom:desc:cashDelta') },
    },
    { name: 'docCollection', label: label('custom:field:docCollection'), type: 'text', required: true },
    { name: 'docId', label: label('custom:field:docId'), type: 'text', required: true },
    { name: 'docNumber', label: label('custom:field:docNumber'), type: 'text' },
    { name: 'reversalOf', label: label('custom:field:reversalOf'), type: 'relationship', relationTo: 'cash-moves' },
  ],
}
