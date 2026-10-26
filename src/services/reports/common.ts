import type { PayloadRequest } from 'payload'

/**
 * Спільне для звітів (docs/accounting/design.md, розд. 12): лише читання, агрегації MongoDB у сесії
 * транзакції `req` (якщо вона відкрита), суми в цілих банях.
 */

export type ObjectIdLike = { toString(): string }

export const model = (req: PayloadRequest, slug: string) => req.payload.db.collections[slug]

export type Pipeline = Parameters<ReturnType<typeof model>['aggregate']>[0]

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
export const toObjectId = (req: PayloadRequest, id: string) => new (model(req, 'orders').base.Types.ObjectId)(id)

/** Сесія транзакції `req` для читання; без відкритої транзакції `undefined`. */
export const readSession = async (req: PayloadRequest) => {
  const transactionID = await req.transactionID

  return transactionID === undefined ? undefined : req.payload.db.sessions?.[transactionID]
}

export type ReadSession = Awaited<ReturnType<typeof readSession>>

/** Агрегація в сесії `req`; `pipeline` будується звітом, перший етап завжди `$match`. */
export const aggregate = async <T>(req: PayloadRequest, slug: string, pipeline: unknown[], session: ReadSession) =>
  model(req, slug)
    .aggregate<T>(pipeline as Pipeline)
    .session(session ?? null)

/** Назва колекції MongoDB для `$lookup`. */
export const collectionName = (req: PayloadRequest, slug: string) => model(req, slug).collection.collectionName

export type Period = { from: string; to: string; start: Date; end: Date }

/**
 * Документ або операція враховуються в періоді, якщо дата ∈ [start, end] і на `end` вони не
 * сторновані: `posted` або `reversed` зі сторно пізніше `end`. Чернетки ніколи (як у C4).
 */
export const countedInPeriod = (dateField: string, { start, end }: Pick<Period, 'start' | 'end'>) => ({
  status: { $in: ['posted', 'reversed'] },
  [dateField]: { $gte: start, $lte: end },
  $or: [{ status: 'posted' }, { reversedAt: { $gt: end } }],
})

export type ReportWarning =
  | { code: 'PERIOD_BEFORE_ACCOUNTING_START'; accountingStartAt: string }
  | { code: 'ACCOUNTING_NOT_STARTED' }

/** Попередження, якщо період починається раніше за запуск обліку або облік ще не запущено. */
export const accountingWarnings = async (req: PayloadRequest, start: Date): Promise<ReportWarning[]> => {
  const { accountingStartAt } = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })

  if (!accountingStartAt) return [{ code: 'ACCOUNTING_NOT_STARTED' }]
  if (start.getTime() < new Date(accountingStartAt).getTime()) {
    return [{ code: 'PERIOD_BEFORE_ACCOUNTING_START', accountingStartAt: new Date(accountingStartAt).toISOString() }]
  }

  return []
}

export const reportHeader = (period?: Pick<Period, 'from' | 'to'>) => ({
  currency: 'MDL' as const,
  unit: 'bani' as const,
  ...(period ? { period: { from: period.from, to: period.to } } : {}),
})

export type Paging = { page: number; limit: number }

export const pagination = ({ page, limit }: Paging, total: number) => ({ page, limit, total })

export const idOrNull = (value: ObjectIdLike | null | undefined) => (value ? String(value) : null)

/**
 * Довідкові документи за id одним запитом (без N+1): назви складів, кас, статей, постачальників,
 * користувачів для рядків звіту. Повертає Map за рядковим id.
 */
export const loadByIds = async <T extends { _id: ObjectIdLike }>(
  req: PayloadRequest,
  slug: string,
  ids: Array<ObjectIdLike | null | undefined>,
  projection: Record<string, 1>,
  session: ReadSession,
): Promise<Map<string, T>> => {
  const unique = [...new Map(ids.filter((id): id is ObjectIdLike => Boolean(id)).map((id) => [String(id), id])).values()]
  if (unique.length === 0) return new Map()

  const docs = (await model(req, slug)
    .collection.find({ _id: { $in: unique as never[] } }, { session, projection })
    .toArray()) as unknown as T[]

  return new Map(docs.map((doc) => [String(doc._id), doc]))
}

export type UserDoc = { _id: ObjectIdLike; name?: string; surname?: string; email?: string }

export const USER_PROJECTION = { name: 1, surname: 1, email: 1 } as const

/** Ім'я користувача для звіту: ім'я й прізвище, інакше email. */
export const personName = (user: UserDoc | undefined) =>
  user ? [user.name, user.surname].filter(Boolean).join(' ') || user.email || null : null

export const isoOrNull = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null)
