import { APIError, type PayloadRequest } from 'payload'

import { customT } from '@/i18n'
import type { PayrollSchemeParams } from './calculatePayroll'
import { dayKey, endOfDay, startOfDay } from './period'
import type { PayrollSelectionScheme } from './selectPayrollOrders'

/**
 * Схеми зарплати (docs/accounting/design.md, розд. 2.5): чинність на дату, вибір для менеджера,
 * неперетин інтервалів. Дати порівнюються календарними днями поясу обліку, порожній `validFrom`
 * означає «від початку», порожній `validTo` означає «безстроково». Сирі запити в сесії `req`.
 */

export type SalarySchemeData = PayrollSchemeParams &
  PayrollSelectionScheme & {
    id: string
    name: string
    /** `null` = схема за замовчуванням для всіх менеджерів. */
    manager: string | null
    validFrom: string | null
    validTo: string | null
    period: string | null
  }

type ObjectIdLike = { toString(): string }

type SchemeRow = Omit<SalarySchemeData, 'id' | 'manager' | 'validFrom' | 'validTo'> & {
  _id: ObjectIdLike
  manager?: ObjectIdLike | null
  validFrom?: Date | null
  validTo?: Date | null
}

const schemes = (req: PayloadRequest) => req.payload.db.collections['salary-schemes']

const toObjectId = (req: PayloadRequest, id: string) => new (schemes(req).base.Types.ObjectId)(id)

const readSession = async (req: PayloadRequest) => {
  const transactionID = await req.transactionID

  return transactionID === undefined ? undefined : req.payload.db.sessions?.[transactionID]
}

const toScheme = ({ _id, manager, validFrom, validTo, ...row }: SchemeRow): SalarySchemeData => ({
  ...row,
  id: String(_id),
  manager: manager ? String(manager) : null,
  validFrom: validFrom ? new Date(validFrom).toISOString() : null,
  validTo: validTo ? new Date(validTo).toISOString() : null,
})

/** Умова «інтервал схеми перетинає дні [from, to]»; порожня межа = нескінченність. */
const overlaps = (from: Date | string | null | undefined, to: Date | string | null | undefined) => ({
  $and: [
    to ? { $or: [{ validFrom: null }, { validFrom: { $lte: endOfDay(dayKey(to)) } }] } : {},
    from ? { $or: [{ validTo: null }, { validTo: { $gte: startOfDay(dayKey(from)) } }] } : {},
  ],
})

const managerMatch = (req: PayloadRequest, manager: string | null) => ({
  manager: manager ? toObjectId(req, manager) : null,
})

const findOne = async (req: PayloadRequest, filter: Record<string, unknown>): Promise<SalarySchemeData | null> => {
  const row = await schemes(req)
    .collection.find<SchemeRow>(filter, { session: await readSession(req) })
    .sort({ validFrom: -1, _id: -1 })
    .limit(1)
    .next()

  return row ? toScheme(row) : null
}

/** Схема за id або `null`. */
export const findScheme = (req: PayloadRequest, id: string): Promise<SalarySchemeData | null> =>
  findOne(req, { _id: toObjectId(req, id) })

/** Чи чинна схема на день `onDate`. */
export const isSchemeValidOn = (scheme: Pick<SalarySchemeData, 'validFrom' | 'validTo'>, onDate: Date | string) => {
  const day = dayKey(onDate)

  return (!scheme.validFrom || dayKey(scheme.validFrom) <= day) && (!scheme.validTo || dayKey(scheme.validTo) >= day)
}

/**
 * Схема для менеджера на день `onDate`: спершу його власна чинна схема, інакше чинна схема за
 * замовчуванням, інакше помилка «схему не знайдено».
 */
export const pickScheme = async (req: PayloadRequest, managerId: string, onDate: Date | string): Promise<SalarySchemeData> => {
  const validOn = overlaps(onDate, onDate)
  const scheme =
    (await findOne(req, { ...managerMatch(req, managerId), ...validOn })) ??
    (await findOne(req, { ...managerMatch(req, null), ...validOn }))

  if (!scheme) {
    throw new APIError(customT(req.t)('custom:error:salarySchemeNotFound', { date: dayKey(onDate) }), 404, undefined, true)
  }

  return scheme
}

/**
 * Інша схема того самого менеджера (або інша схема за замовчуванням), що перетинається з
 * інтервалом `[validFrom, validTo]`; `null`, якщо такої немає.
 */
export const findOverlappingScheme = (
  req: PayloadRequest,
  { id, manager, validFrom, validTo }: { id?: string | null; manager: string | null; validFrom?: string | null; validTo?: string | null },
): Promise<SalarySchemeData | null> =>
  findOne(req, {
    ...(id ? { _id: { $ne: toObjectId(req, id) } } : {}),
    ...managerMatch(req, manager),
    ...overlaps(validFrom, validTo),
  })
