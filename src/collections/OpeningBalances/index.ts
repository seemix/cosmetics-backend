import { APIError, type CollectionBeforeChangeHook, type CollectionConfig, type PayloadRequest } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { activeCashAccountsOnly } from '@/collections/Finance/CashAccounts'
import { applyCashMoves, revertCashMoves } from '@/collections/Finance/cashLedger'
import { validateInteger } from '@/collections/Stock/shared'
import { moneyField } from '@/fields/money'
import { collectionLabels, customT, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { receive, revert } from '@/services/stock/stockLedger.service'

type Relation = string | { id: string }
type StockLine = { warehouse: Relation; product: Relation; quantity: number; unitCostBani: number }
type CashLine = { account: Relation; amountBani: number }

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const fail = (req: PayloadRequest, key: CustomTranslationsKeys): never => {
  throw new APIError(customT(req.t)(key), 400, undefined, true)
}

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'opening-balances',
  id,
  number: String(data.number ?? originalDoc.number),
})

/** Проведення kind=stock як прихід: вартість рядка `quantity × unitCostBani`, рух `opening` (розд. 3.2). */
const postOpening = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.stockLines ?? originalDoc.stockLines ?? []) as StockLine[]

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  await receive(req, {
    doc: docRef(args),
    date,
    moveType: 'opening',
    lines: lines.map((line) => ({
      product: idOf(line.product),
      warehouse: idOf(line.warehouse),
      qty: line.quantity,
      valueBani: line.quantity * line.unitCostBani,
    })),
  })
}

/** Сторно як сторно приходу: умовне списання, `qty = 0 ⇒ value = 0`, блок при `value < 0`. */
const reverseOpening = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'opening-balances' },
      docId: { equals: id },
      moveType: { equals: 'opening' },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}

/** Проведення kind=cash: `cash-moves +amount` і `balanceBani += amount` у тій самій транзакції (розд. 3.2). */
const postCashOpening = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.cashLines ?? originalDoc.cashLines ?? []) as CashLine[]

  if (lines.length === 0) fail(req, 'custom:error:openingNoLines')

  await applyCashMoves(req, {
    doc: docRef(args),
    date,
    lines: lines.map((line) => ({ account: idOf(line.account), deltaBani: line.amountBani })),
  })
}

/** Сторно kind=cash: дзеркальні `cash-moves`; якщо з каси вже витрачено, помилка нестачі. */
const reverseCashOpening = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'cash-moves',
    where: { docCollection: { equals: 'opening-balances' }, docId: { equals: id } },
    pagination: false,
    depth: 0,
    req,
  })

  await revertCashMoves(req, { doc: docRef(args), date, moves })
}

const kindOf = ({ data, originalDoc }: Pick<DocumentTransitionArgs, 'data' | 'originalDoc'>) =>
  (data.kind ?? originalDoc.kind ?? 'stock') as 'stock' | 'cash'

const lifecycle = documentLifecycle({
  prefix: 'OPN',
  counterKey: 'openingNumber',
  onPost: (args) => (kindOf(args) === 'cash' ? postCashOpening(args) : postOpening(args)),
  onReverse: (args) => (kindOf(args) === 'cash' ? reverseCashOpening(args) : reverseOpening(args)),
})

/** Один рядок на пару товар × склад і на касу: дубль подвоїв би залишок. */
const validateOpening: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const isCash = kindOf({ data, originalDoc: originalDoc ?? {} }) === 'cash'
  const keys = isCash
    ? ((data.cashLines ?? originalDoc?.cashLines ?? []) as CashLine[]).map((line) => String(idOf(line.account)))
    : ((data.stockLines ?? originalDoc?.stockLines ?? []) as StockLine[]).map(
        (line) => `${idOf(line.product)}:${idOf(line.warehouse)}`,
      )

  if (new Set(keys).size !== keys.length) {
    fail(req, isCash ? 'custom:error:openingDuplicateAccount' : 'custom:error:openingDuplicate')
  }

  return data
}

/** Початкові залишки, див. docs/accounting/design.md, розд. 2.2, 10. Kinds supplierDebt/customerDebt додаються в C5. */
export const OpeningBalances: CollectionConfig = {
  slug: 'opening-balances',
  labels: collectionLabels('custom:collection:openingBalances:singular', 'custom:collection:openingBalances:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'kind', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:stock'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    beforeChange: [validateOpening, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'kind',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      defaultValue: 'stock',
      options: [
        { label: label('custom:option:openingStock'), value: 'stock' },
        { label: label('custom:option:openingCash'), value: 'cash' },
      ],
    },
    {
      name: 'cashLines',
      label: label('custom:field:cashLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'cash' },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'account',
              label: label('custom:term:cashAccount'),
              type: 'relationship',
              relationTo: 'cash-accounts',
              required: true,
              filterOptions: activeCashAccountsOnly,
            },
            moneyField({ name: 'amountBani', label: label('custom:term:amount'), required: true, min: 1 }),
          ],
        },
      ],
    },
    {
      name: 'stockLines',
      label: label('custom:field:stockLines'),
      type: 'array',
      required: true,
      minRows: 1,
      admin: { condition: (data) => data?.kind === 'stock' },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'warehouse',
              label: label('custom:term:warehouse'),
              type: 'relationship',
              relationTo: 'warehouses',
              required: true,
              filterOptions: { isActive: { equals: true } },
            },
            { name: 'product', label: label('custom:term:product'), type: 'relationship', relationTo: 'products', required: true },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'quantity', label: label('custom:term:quantity'), type: 'number', required: true, min: 1, validate: validateInteger },
            moneyField({ name: 'unitCostBani', label: label('custom:field:unitCost'), required: true, min: 1 }),
          ],
        },
      ],
    },
  ],
}
