import { APIError, type PayloadRequest } from 'payload'

import { customT, type CustomTranslationsKeys } from '@/i18n'
import { requireSession } from '@/services/stock/session'
import { formatMDL } from '@/utilities/money'

/**
 * Виплати за розрахунком зарплати (M4): `payrolls.paidBani` змінюється лише тут, сирим умовним
 * `updateOne` у сесії транзакції `req`, у тій самій транзакції, що й рух коштів каси. Хуки й
 * життєвий цикл payroll при цьому не спрацьовують: проведений розрахунок лишається незмінним.
 */

type PayrollRow = {
  _id: { toString(): string }
  number?: string | null
  status?: string | null
  manager?: { toString(): string } | null
  totalBani?: number | null
  paidBani?: number | null
}

const payrolls = (req: PayloadRequest) => req.payload.db.collections['payrolls']

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) => new (payrolls(req).base.Types.ObjectId)(id)

const fail = (req: PayloadRequest, key: CustomTranslationsKeys, variables?: Record<string, string>): never => {
  throw new APIError(customT(req.t)(key, variables), 409, undefined, true)
}

const PAID_EXPR = { $ifNull: ['$paidBani', 0] }

/**
 * Атомарна зміна `paidBani` на `deltaBani`. Виплата (`deltaBani > 0`): payroll проведений, його
 * менеджер = менеджер операції, переплата понад `totalBani` заборонена. Сторно виплати
 * (`deltaBani < 0`): сплачено не менше за суму. Умови стоять у фільтрі, тож паралельні виплати не
 * можуть їх порушити; якщо фільтр не спрацював, повертається точна причина.
 */
export const changePayrollPaid = async (
  req: PayloadRequest,
  { payroll, manager, deltaBani }: { payroll: string; manager: string | null; deltaBani: number },
) => {
  if (!Number.isInteger(deltaBani) || deltaBani === 0) {
    throw new Error(`Payroll payment delta must be a non-zero whole number of bani, got ${deltaBani}`)
  }

  const session = await requireSession(req)
  const _id = toObjectId(req, payroll)
  const filter =
    deltaBani > 0
      ? {
          _id,
          status: 'posted',
          manager: manager ? toObjectId(req, manager) : null,
          $expr: { $lte: [{ $add: [PAID_EXPR, deltaBani] }, { $ifNull: ['$totalBani', 0] }] },
        }
      : { _id, $expr: { $gte: [PAID_EXPR, -deltaBani] } }

  const result = await payrolls(req).collection.updateOne(
    filter,
    { $inc: { paidBani: deltaBani }, $set: { updatedAt: new Date() } },
    { session },
  )
  if (result.modifiedCount > 0) return

  const current = await payrolls(req).collection.findOne<PayrollRow>({ _id }, { session })
  if (!current) fail(req, 'custom:error:payrollNotFound', { payroll })

  const doc = current as PayrollRow
  const number = doc.number ?? payroll
  const paid = Number(doc.paidBani) || 0

  if (deltaBani > 0) {
    if (doc.status !== 'posted') fail(req, 'custom:error:payrollNotPosted', { payroll: number })
    if (String(doc.manager ?? '') !== String(manager ?? '')) fail(req, 'custom:error:payrollManagerMismatch', { payroll: number })
    fail(req, 'custom:error:payrollOverpaid', {
      payroll: number,
      requested: formatMDL(deltaBani),
      remaining: formatMDL(Math.max((Number(doc.totalBani) || 0) - paid, 0)),
    })
  }

  fail(req, 'custom:error:payrollPaidExceeded', { payroll: number, requested: formatMDL(-deltaBani), paid: formatMDL(paid) })
}

/** Поточна сума виплат за розрахунком, читання в сесії транзакції `req`. */
export const readPayrollPaidBani = async (req: PayloadRequest, payroll: string): Promise<number> => {
  const session = await requireSession(req)
  const doc = await payrolls(req).collection.findOne<PayrollRow>({ _id: toObjectId(req, payroll) }, { session })

  return Number(doc?.paidBani) || 0
}
