import {
  APIError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest,
  type Where,
} from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdminOrManager, isAdmin } from '@/access/isAdmin'
import { checkRole } from '@/access/utilities'
import { managerField } from '@/collections/Salary/managerField'
import { moneyField } from '@/fields/money'
import { collectionLabels, customT, description, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { COUNTERS_COLLECTION } from '@/services/counters'
import { documentLifecycle, type DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { calculatePayroll } from '@/services/salary/calculatePayroll'
import { readPayrollPaidBani } from '@/services/salary/payrollPayments.service'
import { dayKey, periodBounds } from '@/utilities/period'
import { findScheme, isSchemeValidOn, pickScheme, type SalarySchemeData } from '@/services/salary/pickScheme'
import { selectPayrollOrders } from '@/services/salary/selectPayrollOrders'
import { requireSession } from '@/services/stock/session'

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' ? String((value as { id: unknown }).id) : value ? String(value) : null

const fail = (req: PayloadRequest, key: CustomTranslationsKeys, status = 400, variables?: Record<string, string>): never => {
  throw new APIError(customT(req.t)(key, variables), status, undefined, true)
}

/** Розд. 11, В12: admin усе; manager читає лише свої проведені розрахунки; решта нічого. */
const readPayrolls: Access = ({ req: { user } }) => {
  if (!user) return false
  if (isAdmin(user)) return true
  if (checkRole(['manager'], user)) {
    const own: Where = { and: [{ manager: { equals: user.id } }, { status: { equals: 'posted' } }] }
    return own
  }

  return false
}

/**
 * Схема розрахунку: обрана в чернетці, якщо вона цього менеджера (або за замовчуванням) і чинна на
 * `periodTo`; інакше `pickScheme`. Явно обрана невідповідна схема відхиляється, а автоматично
 * підставлена раніше після зміни менеджера чи періоду просто обирається заново.
 */
const resolveScheme = async (
  req: PayloadRequest,
  { chosen, previous, manager, periodTo }: { chosen: string | null | undefined; previous: string | null; manager: string; periodTo: string },
): Promise<SalarySchemeData> => {
  const current = chosen !== undefined ? chosen : previous

  if (current) {
    const scheme = await findScheme(req, current)
    const fits = scheme && (scheme.manager === null || scheme.manager === manager) && isSchemeValidOn(scheme, periodTo)
    if (fits) return scheme
    if (current !== previous) fail(req, 'custom:error:payrollSchemeInvalid')
  }

  return pickScheme(req, manager, periodTo)
}

const snapshotOf = (scheme: SalarySchemeData) => ({
  id: scheme.id,
  name: scheme.name,
  manager: scheme.manager,
  validFrom: scheme.validFrom,
  validTo: scheme.validTo,
  fixedBani: Number(scheme.fixedBani) || 0,
  percentBp: scheme.percentBp,
  base: scheme.base,
  dateBasis: scheme.dateBasis,
  attribution: scheme.attribution,
  customerFilter: scheme.customerFilter ?? 'all',
  period: scheme.period ?? 'month',
})

/**
 * Чернетка (і перехід у `posted`) перераховується на кожне збереження: схема, рядки, суми, знімок
 * схеми. Проведення робить це в тій самій транзакції, тож затверджується саме збережений результат.
 * `paidBani` це кеш виплат, який змінює лише `changePayrollPaid`; із запиту він не береться ніколи.
 */
const preparePayroll: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const original = (originalDoc ?? {}) as Record<string, unknown>
  data.paidBani = Number(original.paidBani) || 0

  if (operation === 'update' && original.status !== 'draft') return data

  const value = (field: string) => (data[field] !== undefined ? data[field] : original[field])
  const manager = idOf(value('manager'))
  const periodFrom = value('periodFrom') ? String(value('periodFrom')) : null
  const periodTo = value('periodTo') ? String(value('periodTo')) : null
  // Обов'язковість цих полів перевіряє сама валідація Payload.
  if (!manager || !periodFrom || !periodTo) return data

  if (dayKey(periodTo) < dayKey(periodFrom)) fail(req, 'custom:error:payrollPeriodInvalid')

  const adjustmentsBani = Number(value('adjustmentsBani')) || 0
  const comment = typeof value('comment') === 'string' ? String(value('comment')).trim() : ''
  if (adjustmentsBani !== 0 && !comment) fail(req, 'custom:error:payrollAdjustmentComment')

  const scheme = await resolveScheme(req, {
    chosen: data.scheme === undefined ? undefined : idOf(data.scheme),
    previous: idOf(original.scheme),
    manager,
    periodTo,
  })
  const orders = await selectPayrollOrders(req, { manager, ...periodBounds(periodFrom, periodTo), scheme })
  const result = calculatePayroll({ scheme, orders, adjustmentsBani })

  return Object.assign(data, result, { scheme: scheme.id, schemeSnapshot: snapshotOf(scheme), adjustmentsBani })
}

/**
 * Проведення: заборонене, якщо в менеджера вже є проведений розрахунок, що перетинає період.
 * Перед перевіркою транзакція бере «замок» менеджера (умовний запис у `counters`): два паралельні
 * проведення того самого менеджера конфліктують на ньому, і друге відкочується.
 */
const postPayroll = async ({ req, id, data, originalDoc }: DocumentTransitionArgs) => {
  const session = await requireSession(req)
  const manager = String(idOf(data.manager ?? originalDoc.manager))
  const { from, to } = periodBounds(String(data.periodFrom ?? originalDoc.periodFrom), String(data.periodTo ?? originalDoc.periodTo))
  const model = req.payload.db.collections['payrolls']
  const toObjectId = (value: string) => new model.base.Types.ObjectId(value)

  await req.payload.db.connection
    .collection<{ _id: string; value: number }>(COUNTERS_COLLECTION)
    .updateOne({ _id: `payrollLock:${manager}` }, { $inc: { value: 1 } }, { upsert: true, session })

  const overlapping = await model.collection.findOne<{ number?: string }>(
    {
      _id: { $ne: toObjectId(id) },
      manager: toObjectId(manager),
      status: 'posted',
      periodFrom: { $lte: to },
      periodTo: { $gte: from },
    },
    { session, projection: { number: 1 } },
  )
  if (overlapping) fail(req, 'custom:error:payrollOverlap', 409, { payroll: overlapping.number ?? '' })
}

/** Сторно лише без виплат: спершу сторнуються виплати (касові операції з цим payroll). */
const reversePayroll = async ({ req, id }: DocumentTransitionArgs) => {
  if ((await readPayrollPaidBani(req, id)) > 0) fail(req, 'custom:error:payrollHasPayments', 409)
}

const lifecycle = documentLifecycle({
  prefix: 'PAY',
  counterKey: 'payrollNumber',
  // Дата документа: кінець періоду, на неї й обирається схема.
  dateField: { name: 'periodTo', label: label('custom:field:periodTo') },
  onPost: postPayroll,
  onReverse: reversePayroll,
})

const readOnlyMoney = (name: string, key: CustomTranslationsKeys) =>
  moneyField({ name, label: label(key), defaultValue: 0, admin: { readOnly: true } })

/** Розрахунки зарплати менеджерів, див. docs/accounting/design.md, розд. 2.5, 7.2. */
export const Payrolls: CollectionConfig = {
  slug: 'payrolls',
  labels: collectionLabels('custom:collection:payrolls:singular', 'custom:collection:payrolls:plural'),
  access: {
    read: readPayrolls,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    // Виняток з облікових колекцій: manager бачить свої проведені розрахунки (В12).
    hidden: hiddenUnlessAdminOrManager,
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'manager', 'periodFrom', 'periodTo', 'totalBani', 'paidBani'],
    listSearchableFields: ['number'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-createdAt',
  indexes: [{ fields: ['manager', 'status', 'periodFrom'] }],
  hooks: {
    beforeValidate: lifecycle.hooks.beforeValidate,
    // Спершу розрахунок, потім статуси: проведення затверджує щойно перераховані суми.
    beforeChange: [preparePayroll, ...lifecycle.hooks.beforeChange],
    beforeDelete: lifecycle.hooks.beforeDelete,
  },
  fields: [
    ...lifecycle.fields,
    managerField({ name: 'manager', label: label('custom:term:manager'), required: true, index: true }),
    { name: 'periodFrom', label: label('custom:field:periodFrom'), type: 'date', required: true },
    {
      name: 'scheme',
      label: label('custom:term:salaryScheme'),
      type: 'relationship',
      relationTo: 'salary-schemes',
      admin: { description: description('custom:desc:payrollScheme') },
    },
    moneyField({
      name: 'adjustmentsBani',
      label: label('custom:term:adjustment'),
      defaultValue: 0,
      admin: { description: description('custom:desc:payrollAdjustment') },
    }),
    {
      type: 'row',
      fields: [
        readOnlyMoney('fixedBani', 'custom:term:fixedSalary'),
        readOnlyMoney('baseTotalBani', 'custom:field:baseTotalBani'),
        readOnlyMoney('percentAmountBani', 'custom:field:percentAmountBani'),
      ],
    },
    {
      type: 'row',
      fields: [readOnlyMoney('totalBani', 'custom:field:payrollTotalBani'), readOnlyMoney('paidBani', 'custom:field:paidBani')],
    },
    {
      name: 'lines',
      label: label('custom:field:lines'),
      type: 'array',
      admin: { readOnly: true },
      fields: [
        { name: 'order', label: label('custom:field:order'), type: 'relationship', relationTo: 'orders' },
        { name: 'orderNumber', label: label('custom:field:orderNumber'), type: 'text' },
        moneyField({ name: 'baseBani', label: label('custom:field:baseBani') }),
        moneyField({ name: 'amountBani', label: label('custom:field:commissionBani') }),
      ],
    },
    {
      name: 'schemeSnapshot',
      label: label('custom:field:schemeSnapshot'),
      type: 'json',
      admin: { readOnly: true },
    },
  ],
}
