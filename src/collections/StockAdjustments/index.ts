import { APIError, type CollectionBeforeChangeHook, type CollectionConfig, type PayloadRequest } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { validateInteger } from '@/collections/Stock/shared'
import { moneyField } from '@/fields/money'
import { collectionLabels, customT, description, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { issue, receive, revert } from '@/services/stock/stockLedger.service'

type Relation = string | { id: string }
type Kind = 'writeoff' | 'inventory'
type LineData = {
  product: Relation
  quantity?: number | null
  countedQty?: number | null
  unitCostBani?: number | null
  expectedQty?: number | null
  diffQty?: number | null
  valueBani?: number | null
} & Record<string, unknown>

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const fail = (req: PayloadRequest, key: CustomTranslationsKeys, variables?: Record<string, string>): never => {
  throw new APIError(customT(req.t)(key, variables), 400, undefined, true)
}

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'stock-adjustments',
  id,
  number: String(data.number ?? originalDoc.number),
})

const currentQty = async (req: PayloadRequest, product: string, warehouse: string): Promise<number> =>
  (
    await req.payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouse } },
      limit: 1,
      depth: 0,
      req,
    })
  ).docs[0]?.qty ?? 0

const currentCost = async (req: PayloadRequest, product: string): Promise<{ qty: number; valueBani: number }> => {
  const doc = (
    await req.payload.find({
      collection: 'product-costs',
      where: { product: { equals: product } },
      limit: 1,
      depth: 0,
      req,
    })
  ).docs[0]

  return { qty: doc?.qty ?? 0, valueBani: doc?.valueBani ?? 0 }
}

/** Рух документа за товаром: після `issue` / `receive` у рядку фіксується вартість зміни. */
const valueByProduct = (moves: Array<{ product: unknown; valueDeltaBani: number }>) =>
  new Map(moves.map((move) => [String(idOf(move.product as Relation)), move.valueDeltaBani]))

/**
 * Проведення (розд. 3.2).
 * writeoff: умовне списання за середньою.
 * inventory: `expectedQty` = залишок на момент проведення; нестача списується за середньою,
 * надлишок приходує за поточною середньою, а при нульовому залишку товару за `unitCostBani` рядка.
 */
const postAdjustment = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const kind = (data.kind ?? originalDoc.kind) as Kind
  const lines = (data.lines ?? originalDoc.lines ?? []) as LineData[]
  const warehouse = idOf((data.warehouse ?? originalDoc.warehouse) as Relation)
  const doc = docRef(args)

  if (lines.length === 0) fail(req, 'custom:error:adjustmentNoLines')

  if (kind === 'writeoff') {
    const moves = await issue(req, {
      doc,
      date,
      moveType: 'writeoff',
      lines: lines.map((line) => ({ product: idOf(line.product), warehouse, qty: line.quantity as number })),
    })
    const values = valueByProduct(moves)

    data.lines = lines.map((line) => ({ ...line, valueBani: values.get(String(idOf(line.product))) ?? 0 }))
    return
  }

  const prepared: Array<{ line: LineData; product: string; expectedQty: number; diffQty: number; surplusValue: number }> =
    []

  for (const line of lines) {
    const product = idOf(line.product)
    const expectedQty = await currentQty(req, product, warehouse)
    const diffQty = (line.countedQty as number) - expectedQty
    let surplusValue = 0

    if (diffQty > 0) {
      const cost = await currentCost(req, product)

      if (cost.qty > 0) {
        surplusValue = Math.round((cost.valueBani * diffQty) / cost.qty)
      } else if (line.unitCostBani && line.unitCostBani > 0) {
        surplusValue = diffQty * line.unitCostBani
      } else {
        fail(req, 'custom:error:surplusCostRequired', { product })
      }
    }

    prepared.push({ line, product, expectedQty, diffQty, surplusValue })
  }

  const shortages = prepared.filter((row) => row.diffQty < 0)
  const surpluses = prepared.filter((row) => row.diffQty > 0)

  const issued = shortages.length
    ? await issue(req, {
        doc,
        date,
        moveType: 'inventory',
        lines: shortages.map((row) => ({ product: row.product, warehouse, qty: -row.diffQty })),
      })
    : []
  const received = surpluses.length
    ? await receive(req, {
        doc,
        date,
        moveType: 'inventory',
        lines: surpluses.map((row) => ({
          product: row.product,
          warehouse,
          qty: row.diffQty,
          valueBani: row.surplusValue,
        })),
      })
    : []
  const values = valueByProduct([...issued, ...received])

  data.lines = prepared.map(({ line, product, expectedQty, diffQty }) => ({
    ...line,
    expectedQty,
    diffQty,
    valueBani: values.get(product) ?? 0,
  }))
}

/** Сторно повертає точні кількості й вартості з журналу проведення. */
const reverseAdjustment = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'stock-adjustments' },
      docId: { equals: id },
      moveType: { in: ['writeoff', 'inventory'] },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}

const lifecycle = documentLifecycle({
  prefix: 'ADJ',
  counterKey: 'adjustmentNumber',
  onPost: postAdjustment,
  onReverse: reverseAdjustment,
})

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0

/** Правила рядків для чернетки й моменту проведення; проведений документ уже незмінний. */
const validateAdjustment: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if ((originalDoc?.status ?? 'draft') !== 'draft') return data

  const kind = (data.kind ?? originalDoc?.kind) as Kind | undefined
  const lines = (data.lines ?? originalDoc?.lines ?? []) as LineData[]
  const products = lines.map((line) => String(idOf(line.product)))

  if (new Set(products).size !== products.length) fail(req, 'custom:error:adjustmentDuplicateProduct')

  if (kind === 'writeoff') {
    if (!(data.reason ?? originalDoc?.reason)) fail(req, 'custom:error:writeoffReasonRequired')
    if (lines.some((line) => !Number.isInteger(line.quantity) || (line.quantity as number) <= 0)) {
      fail(req, 'custom:error:writeoffQuantity')
    }
  }

  if (kind === 'inventory') {
    if (lines.some((line) => !isNonNegativeInteger(line.countedQty))) {
      fail(req, 'custom:error:countedQuantity')
    }
    if (lines.some((line) => line.unitCostBani != null && !(line.unitCostBani > 0))) {
      fail(req, 'custom:error:unitCostPositive')
    }
  }

  return data
}

const kindIs = (kind: Kind) => (data: Record<string, unknown>) => data?.kind === kind

/** Списання та інвентаризація, див. docs/accounting/design.md, розд. 2.2, 3.2. */
export const StockAdjustments: CollectionConfig = {
  slug: 'stock-adjustments',
  labels: collectionLabels('custom:collection:stockAdjustments:singular', 'custom:collection:stockAdjustments:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'kind', 'warehouse', 'postedAt'],
    listSearchableFields: ['number'],
    group: localized('custom:group:stock'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['status', 'postedAt'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    beforeChange: [validateAdjustment, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    {
      name: 'kind',
      label: label('custom:term:kind'),
      type: 'select',
      required: true,
      options: [
        { label: label('custom:option:kindWriteoff'), value: 'writeoff' },
        { label: label('custom:option:kindInventory'), value: 'inventory' },
      ],
    },
    {
      name: 'warehouse',
      label: label('custom:term:warehouse'),
      type: 'relationship',
      relationTo: 'warehouses',
      required: true,
      filterOptions: { isActive: { equals: true } },
    },
    {
      name: 'reason',
      label: label('custom:term:reason'),
      type: 'select',
      options: [
        { label: label('custom:option:reasonDamage'), value: 'damage' },
        { label: label('custom:option:reasonExpired'), value: 'expired' },
        { label: label('custom:option:reasonTester'), value: 'tester' },
        { label: label('custom:option:reasonInternal'), value: 'internal' },
        { label: label('custom:option:reasonOther'), value: 'other' },
      ],
      admin: { condition: kindIs('writeoff'), description: description('custom:desc:reasonRequiredWriteoff') },
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
          name: 'quantity',
          label: label('custom:field:quantityToWriteOff'),
          type: 'number',
          min: 1,
          validate: validateInteger,
          admin: { condition: (data) => data?.kind !== 'inventory' },
        },
        {
          type: 'row',
          fields: [
            {
              name: 'countedQty',
              label: label('custom:field:countedQty'),
              type: 'number',
              min: 0,
              validate: validateInteger,
              admin: { description: description('custom:desc:countedQty') },
            },
            {
              name: 'expectedQty',
              label: label('custom:field:expectedQty'),
              type: 'number',
              admin: { readOnly: true, description: description('custom:desc:expectedQty') },
            },
            {
              name: 'diffQty',
              label: label('custom:field:diffQty'),
              type: 'number',
              admin: { readOnly: true, description: description('custom:desc:countedMinusExpected') },
            },
          ],
        },
        {
          type: 'row',
          fields: [
            moneyField({
              name: 'unitCostBani',
              label: label('custom:field:unitCost'),
              min: 1,
              admin: { description: description('custom:desc:surplusUnitCost') },
            }),
            moneyField({
              name: 'valueBani',
              label: label('custom:field:valueOfChange'),
              admin: { readOnly: true, description: description('custom:desc:valueOfChange') },
            }),
          ],
        },
      ],
    },
  ],
}
