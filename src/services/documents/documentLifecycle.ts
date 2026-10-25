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
  type LabelFunction,
  killTransaction,
  type PayloadRequest,
} from 'payload'

import { checkRole } from '@/access/utilities'
import { customT, description, label, type CustomTranslationsKeys } from '@/i18n'
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
  dateField?: { name: string; label: string | LabelFunction }
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

const STATUS_OPTIONS: Array<{ label: LabelFunction; value: DocumentStatus }> = [
  { label: label('custom:status:draft'), value: 'draft' },
  { label: label('custom:status:posted'), value: 'posted' },
  { label: label('custom:status:reversed'), value: 'reversed' },
]

/** Помилка з текстом мовою адмінки (`req.t`); `code` лишається англійським ключем словника. */
const fail = (
  req: PayloadRequest,
  key: CustomTranslationsKeys,
  status = 400,
  variables?: Record<string, string>,
): never => {
  throw new APIError(customT(req.t)(key, variables), status, undefined, true)
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
    fail(req, 'custom:error:periodLocked', 409, { date: String(lockedUntil) })
  }
}

const assertAdmin = (req: PayloadRequest, action: 'post' | 'reverse') => {
  if (!checkRole(['admin'], req.user)) {
    fail(req, action === 'post' ? 'custom:error:adminOnlyPost' : 'custom:error:adminOnlyReverse', 403)
  }
}

/** Поля шапки документа (розд. 2.2). */
const headerFields = ({ dateField }: Required<Pick<DocumentLifecycleOptions, 'dateField'>>): Field[] => [
  {
    name: 'number',
    label: label('custom:term:number'),
    type: 'text',
    unique: true,
    index: true,
    admin: { readOnly: true, position: 'sidebar' },
  },
  {
    name: 'status',
    label: label('custom:term:status'),
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
    label: label('custom:field:postedAt'),
    type: 'date',
    index: true,
    admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
  },
  { name: 'postedBy', label: label('custom:field:postedBy'), type: 'relationship', relationTo: 'users', admin: { readOnly: true, position: 'sidebar' } },
  {
    name: 'reversedAt',
    label: label('custom:field:reversedAt'),
    type: 'date',
    admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } },
  },
  { name: 'reversedBy', label: label('custom:field:reversedBy'), type: 'relationship', relationTo: 'users', admin: { readOnly: true, position: 'sidebar' } },
  {
    name: 'reversalReason',
    label: label('custom:term:reversalReason'),
    type: 'textarea',
    admin: {
      description: description('custom:desc:reversalRequired'),
      condition: (data) => data?.status === 'posted' || data?.status === 'reversed',
    },
  },
  { name: 'comment', label: label('custom:term:comment'), type: 'textarea' },
]

/** Фабрика полів шапки й хуків життєвого циклу документа. */
export const documentLifecycle = ({
  prefix,
  counterKey,
  dateField = { name: 'documentDate', label: label('custom:field:documentDate') },
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
      if ((data.status ?? 'draft') !== 'draft') fail(req, 'custom:error:createAsDraft')

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

    if (from === 'reversed') fail(req, 'custom:error:reversedFinal', 409)

    if (from === 'posted') {
      if (to !== 'posted' && to !== 'reversed') fail(req, 'custom:error:postedOnlyReverse', 409)

      const allowed = to === 'reversed' ? REVERSAL_FIELDS : new Set<string>()
      const changed = changedFields(data, original).filter((key) => !allowed.has(key))
      if (changed.length > 0) fail(req, 'custom:error:postedImmutable', 409, { fields: changed.join(', ') })
    }

    if (from === 'draft' && to === 'reversed') fail(req, 'custom:error:onlyPostedReversible', 409)

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
      if (!reason) fail(req, 'custom:error:reversalReasonRequired')
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

    if (status && status !== 'draft') fail(req, 'custom:error:onlyDraftDeletable', 409)
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
