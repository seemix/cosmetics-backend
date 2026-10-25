import { isDeepStrictEqual } from 'node:util'

import {
  APIError,
  commitTransaction,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeValidateHook,
  type CollectionSlug,
  type Field,
  initTransaction,
  killTransaction,
  type PayloadRequest,
} from 'payload'

import { checkRole } from '@/access/utilities'
import { formatDocNumber, nextCounterValue } from '@/services/counters'
import { isTransientTransactionError } from '@/services/stock/errors'

/**
 * Спільний життєвий цикл документів складу й фінансів (docs/accounting/design.md, розд. 3.1):
 * `draft → posted → reversed`, незмінність проведених, заборона видалення, закритий період.
 * Колекція отримує поля шапки й хуки з `documentLifecycle(...)`, а проведення й сторно
 * передає колбеками `onPost` / `onReverse`, які виконуються в транзакції операції `req`.
 */

export type DocumentStatus = 'draft' | 'posted' | 'reversed'

export type DocumentTransitionArgs = {
  req: PayloadRequest
  id: string
  /** Дані, що будуть збережені; колбек може їх доповнити (наприклад, `expectedQty`). */
  data: Record<string, unknown>
  originalDoc: Record<string, unknown>
  /** Дата обліку: момент проведення або сторно. */
  date: Date
}

export type DocumentLifecycleOptions = {
  /** Префікс номера: `PUR` → `PUR-000001`. */
  prefix: string
  /** Ключ у `counters` (розд. 8), напр. `purchaseNumber`. */
  counterKey: string
  /** Поле дати документа: `documentDate` (за замовчуванням) або, наприклад, `operationDate`. */
  dateField?: { name: string; label: string }
  onPost?: (args: DocumentTransitionArgs) => Promise<void> | void
  onReverse?: (args: DocumentTransitionArgs) => Promise<void> | void
}

/** Поля, які може змінювати лише цей хук. */
const SYSTEM_FIELDS = ['number', 'postedAt', 'postedBy', 'reversedAt', 'reversedBy'] as const
/** Поля, які не порівнюються при перевірці незмінності. */
const IGNORED_FIELDS = new Set(['id', '_id', '__v', 'createdAt', 'updatedAt'])
/** Що дозволено змінити в проведеному документі під час сторно. */
const REVERSAL_FIELDS = new Set(['status', 'reversalReason', 'reversedAt', 'reversedBy'])

export const MAX_TRANSACTION_ATTEMPTS = 3

const STATUS_OPTIONS: Array<{ label: string; value: DocumentStatus }> = [
  { label: 'Draft', value: 'draft' },
  { label: 'Posted', value: 'posted' },
  { label: 'Reversed', value: 'reversed' },
]

const fail = (message: string, status = 400): never => {
  throw new APIError(message, status, undefined, true)
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value

// null і відсутнє значення рівнозначні; дати й ObjectId порівнюються в JSON-формі.
const normalize = (value: unknown) => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)))

const changedFields = (data: Record<string, unknown>, originalDoc: Record<string, unknown>) =>
  Object.keys(data).filter(
    (key) => !IGNORED_FIELDS.has(key) && !isDeepStrictEqual(normalize(data[key]), normalize(originalDoc[key])),
  )

const assertPeriodOpen = async (req: PayloadRequest, date: Date) => {
  const { lockedUntil } = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })

  if (lockedUntil && date.getTime() <= new Date(lockedUntil).getTime()) {
    fail(`The period is locked until ${lockedUntil}`, 409)
  }
}

const assertAdmin = (req: PayloadRequest, action: string) => {
  if (!checkRole(['admin'], req.user)) fail(`Only an admin can ${action} a document`, 403)
}

/** Поля шапки документа (розд. 2.2). */
const headerFields = ({ dateField }: Required<Pick<DocumentLifecycleOptions, 'dateField'>>): Field[] => [
  {
    name: 'number',
    label: 'Number',
    type: 'text',
    unique: true,
    index: true,
    admin: { readOnly: true, position: 'sidebar' },
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    defaultValue: 'draft',
    index: true,
    options: STATUS_OPTIONS,
    admin: { position: 'sidebar' },
  },
  { name: dateField.name, label: dateField.label, type: 'date', required: true },
  {
    name: 'postedAt',
    label: 'Posted at',
    type: 'date',
    index: true,
    admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
  },
  { name: 'postedBy', label: 'Posted by', type: 'relationship', relationTo: 'users', admin: { readOnly: true, position: 'sidebar' } },
  {
    name: 'reversedAt',
    label: 'Reversed at',
    type: 'date',
    admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
  },
  { name: 'reversedBy', label: 'Reversed by', type: 'relationship', relationTo: 'users', admin: { readOnly: true, position: 'sidebar' } },
  {
    name: 'reversalReason',
    label: 'Reversal reason',
    type: 'textarea',
    admin: {
      description: 'Required when reversing',
      condition: (data) => data?.status === 'posted' || data?.status === 'reversed',
    },
  },
  { name: 'comment', label: 'Comment', type: 'textarea' },
]

/** Фабрика полів шапки й хуків життєвого циклу документа. */
export const documentLifecycle = ({
  prefix,
  counterKey,
  dateField = { name: 'documentDate', label: 'Document date' },
  onPost,
  onReverse,
}: DocumentLifecycleOptions) => {
  /**
   * MongoDB стартує транзакцію першою операцією в сесії. При створенні першими йдуть паралельні
   * запити валідації `filterOptions` (наприклад, постачальник і склад), і другий падає з
   * `TransientTransactionError`. Один послідовний запит у сесії до валідації стартує транзакцію.
   */
  const startTransaction: CollectionBeforeValidateHook = async ({ collection, data, operation, req }) => {
    if (operation === 'create' && (await req.transactionID)) {
      await req.payload.count({ collection: collection.slug as CollectionSlug, where: { id: { exists: false } }, req })
    }

    return data
  }

  const beforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
    if (operation === 'create') {
      if ((data.status ?? 'draft') !== 'draft') fail('A document is created as a draft and posted afterwards')

      for (const field of SYSTEM_FIELDS) data[field] = null
      data.status = 'draft'
      // Номер видається поза транзакцією: номер відкоченого документа лишається пропуском (розд. 8).
      data.number = formatDocNumber(prefix, await nextCounterValue(req, counterKey))

      return data
    }

    const original = (originalDoc ?? {}) as Record<string, unknown>
    const from = original.status as DocumentStatus
    const to = (data.status ?? from) as DocumentStatus
    const id = String(original.id)

    if (from === 'reversed') fail('A reversed document is final, create a new document instead', 409)

    if (from === 'posted') {
      if (to !== 'posted' && to !== 'reversed') fail('A posted document can only be reversed', 409)

      const allowed = to === 'reversed' ? REVERSAL_FIELDS : new Set<string>()
      const changed = changedFields(data, original).filter((key) => !allowed.has(key))
      if (changed.length > 0) fail(`A posted document cannot be changed (${changed.join(', ')})`, 409)
    }

    if (from === 'draft' && to === 'reversed') fail('Only a posted document can be reversed', 409)

    // Системні поля не змінюються вручну.
    for (const field of SYSTEM_FIELDS) data[field] = original[field] ?? null

    if (from === 'draft' && to === 'posted') {
      assertAdmin(req, 'post')
      const date = new Date()
      await assertPeriodOpen(req, date)

      data.postedAt = date.toISOString()
      data.postedBy = idOf(req.user)
      await onPost?.({ req, id, data, originalDoc: original, date })
    }

    if (from === 'posted' && to === 'reversed') {
      assertAdmin(req, 'reverse')
      const reason = typeof data.reversalReason === 'string' ? data.reversalReason.trim() : ''
      if (!reason) fail('Reversal reason is required')
      const date = new Date()
      await assertPeriodOpen(req, date)

      data.reversalReason = reason
      data.reversedAt = date.toISOString()
      data.reversedBy = idOf(req.user)
      await onReverse?.({ req, id, data, originalDoc: original, date })
    }

    return data
  }

  const beforeDelete: CollectionBeforeDeleteHook = async ({ collection, id, req }) => {
    const doc = await req.payload.findByID({
      collection: collection.slug as CollectionSlug,
      id,
      depth: 0,
      disableErrors: true,
      req,
    })
    const status = (doc as { status?: DocumentStatus } | null)?.status

    if (status && status !== 'draft') fail('Only a draft document can be deleted', 409)
  }

  return {
    fields: headerFields({ dateField }),
    hooks: {
      beforeValidate: [startTransaction],
      beforeChange: [beforeChange],
      beforeDelete: [beforeDelete],
    },
  }
}

/**
 * Виконує `fn` у власній транзакції `req` і повторює її до `attempts` разів на транзієнтних
 * помилках (`WriteConflict`, `TransientTransactionError`, `ConcurrentUpdateError`); між спробами
 * відкат. Якщо транзакція вже відкрита, `fn` виконується в ній один раз: повторює її власник.
 */
export const runInTransaction = async <T>(
  req: PayloadRequest,
  fn: () => Promise<T>,
  { attempts = MAX_TRANSACTION_ATTEMPTS }: { attempts?: number } = {},
): Promise<T> => {
  if (await req.transactionID) return fn()

  for (let attempt = 1; ; attempt++) {
    const started = await initTransaction(req)
    try {
      const result = await fn()
      if (started) await commitTransaction(req)
      return result
    } catch (error) {
      if (started) await killTransaction(req)
      if (!started || attempt >= attempts || !isTransientTransactionError(error)) throw error
    }
  }
}
