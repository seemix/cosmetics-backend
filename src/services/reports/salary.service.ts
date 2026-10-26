import type { PayloadRequest } from 'payload'

import { listManagerDebts } from '@/services/finance/debts.service'

import {
  accountingWarnings,
  aggregate,
  collectionName,
  countedInPeriod,
  isoOrNull,
  loadByIds,
  model,
  type ObjectIdLike,
  type Period,
  personName,
  readSession,
  reportHeader,
  toObjectId,
  USER_PROJECTION,
  type UserDoc,
} from './common'

/**
 * Зарплата менеджерів за період (розд. 7.2, 12):
 * - нараховано: Σ `totalBani` проведених розрахунків з `periodTo` у періоді (сторнований після `end`
 *   ще враховується, як і всюди);
 * - виплачено: Σ проведених витрат зі статтею `isSalary` і цим менеджером за `operationDate`;
 * - борг: `listManagerDebts` (M4) на кінець періоду;
 * - замовлення, скасовані після затвердження розрахунку (ризик Р6), серед розрахунків періоду.
 */

export type PayrollItem = {
  id: string
  number: string | null
  periodFrom: string | null
  periodTo: string | null
  totalBani: number
  paidBani: number
  status: string
}

export type SalaryManagerRow = {
  manager: string
  name: string | null
  accruedBani: number
  paidInPeriodBani: number
  debtBani: number
  payrolls: PayrollItem[]
}

export type CancelledAfterPayroll = {
  order: string
  number: string | null
  payroll: string
  payrollNumber: string | null
  manager: string
  managerName: string | null
  amountBani: number
}

export type SalaryReport = ReturnType<typeof reportHeader> & {
  managers: SalaryManagerRow[]
  totals: { accruedBani: number; paidInPeriodBani: number; debtBani: number }
  cancelledAfterPayroll: { items: CancelledAfterPayroll[]; totalBani: number }
  warnings: Awaited<ReturnType<typeof accountingWarnings>>
}

type PayrollRow = {
  _id: ObjectIdLike
  number?: string
  manager: ObjectIdLike
  periodFrom?: Date
  periodTo?: Date
  totalBani?: number
  paidBani?: number
  status: string
}
type PaidRow = { _id: ObjectIdLike; total: number }
type CancelledRow = {
  order: ObjectIdLike
  number?: string
  payroll: ObjectIdLike
  payrollNumber?: string
  manager: ObjectIdLike
  amountBani?: number
}

/** Нараховане за період: розрахунки з `periodTo` у періоді, проведені на `end` (індекс `{status, periodTo}`). */
export const payrollsInPeriod = ({ start, end }: Pick<Period, 'start' | 'end'>) => ({
  status: { $in: ['posted', 'reversed'] },
  periodTo: { $gte: start, $lte: end },
  $or: [{ status: 'posted' }, { reversedAt: { $gt: end } }],
})

export const getSalaryReport = async (
  req: PayloadRequest,
  period: Period,
  { manager }: { manager?: string },
): Promise<SalaryReport> => {
  const session = await readSession(req)
  const { start, end } = period
  const onlyManager = manager ? { manager: toObjectId(req, manager) } : {}

  // Послідовно: паралельні операції в одній сесії транзакції MongoDB не підтримує.
  const payrolls = await aggregate<PayrollRow>(
    req,
    'payrolls',
    [
      { $match: { ...payrollsInPeriod(period), ...onlyManager } },
      { $sort: { periodTo: 1, number: 1 } },
      { $project: { number: 1, manager: 1, periodFrom: 1, periodTo: 1, totalBani: 1, paidBani: 1, status: 1 } },
    ],
    session,
  )
  const salaryCategories = await model(req, 'expense-categories')
    .collection.find<{ _id: ObjectIdLike }>({ isSalary: true }, { session, projection: { _id: 1 } })
    .toArray()
  const paid = await aggregate<PaidRow>(
    req,
    'cash-operations',
    [
      {
        $match: {
          type: 'expense',
          ...countedInPeriod('operationDate', period),
          category: { $in: salaryCategories.map((category) => category._id) },
          manager: manager ? toObjectId(req, manager) : { $ne: null },
        },
      },
      { $group: { _id: '$manager', total: { $sum: '$amountBani' } } },
    ],
    session,
  )
  // Рядки затверджених (зараз `posted`) розрахунків періоду, чиє замовлення зараз скасоване.
  const cancelled = await aggregate<CancelledRow>(
    req,
    'payrolls',
    [
      { $match: { status: 'posted', periodTo: { $gte: start, $lte: end }, ...onlyManager } },
      { $unwind: '$lines' },
      {
        $lookup: {
          from: collectionName(req, 'orders'),
          localField: 'lines.order',
          foreignField: '_id',
          pipeline: [{ $match: { status: 'cancelled' } }, { $project: { orderNumber: 1 } }],
          as: 'cancelledOrder',
        },
      },
      { $unwind: '$cancelledOrder' },
      { $sort: { number: 1, 'cancelledOrder.orderNumber': 1 } },
      {
        $project: {
          _id: 0,
          order: '$cancelledOrder._id',
          number: '$cancelledOrder.orderNumber',
          payroll: '$_id',
          payrollNumber: '$number',
          manager: '$manager',
          amountBani: '$lines.amountBani',
        },
      },
    ],
    session,
  )
  const debts = await listManagerDebts(req, end)
  const warnings = await accountingWarnings(req, start)

  const rows = new Map<string, SalaryManagerRow>()
  const row = (id: string) => {
    const existing = rows.get(id) ?? { manager: id, name: null, accruedBani: 0, paidInPeriodBani: 0, debtBani: 0, payrolls: [] }
    rows.set(id, existing)
    return existing
  }

  if (manager) row(manager)
  for (const payroll of payrolls) {
    const target = row(String(payroll.manager))
    target.accruedBani += payroll.totalBani ?? 0
    target.payrolls.push({
      id: String(payroll._id),
      number: payroll.number ?? null,
      periodFrom: isoOrNull(payroll.periodFrom),
      periodTo: isoOrNull(payroll.periodTo),
      totalBani: payroll.totalBani ?? 0,
      paidBani: payroll.paidBani ?? 0,
      status: payroll.status,
    })
  }
  for (const item of paid) row(String(item._id)).paidInPeriodBani = item.total
  for (const debt of debts) {
    // Менеджер без руху в періоді потрапляє у звіт лише з ненульовим боргом.
    if (manager ? debt.manager === manager : debt.debtBani !== 0 || rows.has(debt.manager)) row(debt.manager).debtBani = debt.debtBani
  }

  const users = await loadByIds<UserDoc>(
    req,
    'users',
    [...rows.keys(), ...cancelled.map((item) => String(item.manager))].map((id) => toObjectId(req, id)),
    USER_PROJECTION,
    session,
  )

  const managers = [...rows.values()]
    .map((item) => ({ ...item, name: personName(users.get(item.manager)) }))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || a.manager.localeCompare(b.manager))
  const cancelledItems = cancelled.map((item) => ({
    order: String(item.order),
    number: item.number ?? null,
    payroll: String(item.payroll),
    payrollNumber: item.payrollNumber ?? null,
    manager: String(item.manager),
    managerName: personName(users.get(String(item.manager))),
    amountBani: item.amountBani ?? 0,
  }))

  return {
    ...reportHeader(period),
    managers,
    totals: {
      accruedBani: managers.reduce((sum, item) => sum + item.accruedBani, 0),
      paidInPeriodBani: managers.reduce((sum, item) => sum + item.paidInPeriodBani, 0),
      debtBani: managers.reduce((sum, item) => sum + item.debtBani, 0),
    },
    cancelledAfterPayroll: {
      items: cancelledItems,
      totalBani: cancelledItems.reduce((sum, item) => sum + item.amountBani, 0),
    },
    warnings,
  }
}
