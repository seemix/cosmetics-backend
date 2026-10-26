import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin } from '@/access/isAdmin'
import { managerField } from '@/collections/Salary/managerField'
import { moneyField } from '@/fields/money'
import { percentBpField } from '@/fields/percentBp'
import { collectionLabels, customT, description, label, localized, type CustomTranslationsKeys } from '@/i18n'
import { dayKey } from '@/utilities/period'
import { findOverlappingScheme } from '@/services/salary/pickScheme'

const idOf = (value: unknown) =>
  value && typeof value === 'object' ? String((value as { id: unknown }).id) : value ? String(value) : null

const dateOf = (value: unknown) => (value ? String(value) : null)

/**
 * Правила схеми: `validTo ≥ validFrom`; база `paid_revenue` лише з `dateBasis = payment_date`
 * (оплату можна датувати лише датою оплати); схеми одного менеджера (і схеми за замовчуванням між
 * собою) не перетинаються в часі, тож на будь-яку дату `pickScheme` має не більше одного кандидата.
 */
const validateScheme: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const value = (field: string) => (data[field] !== undefined ? data[field] : originalDoc?.[field])
  const fail = (key: CustomTranslationsKeys, variables?: Record<string, string>): never => {
    throw new APIError(customT(req.t)(key, variables), 400, undefined, true)
  }

  const validFrom = dateOf(value('validFrom'))
  const validTo = dateOf(value('validTo'))
  if (validFrom && validTo && dayKey(validTo) < dayKey(validFrom)) fail('custom:error:salarySchemeValidTo')

  if (value('base') === 'paid_revenue' && value('dateBasis') !== 'payment_date') {
    fail('custom:error:salarySchemePaidRevenueDate')
  }

  const overlapping = await findOverlappingScheme(req, {
    id: originalDoc?.id ? String(originalDoc.id) : null,
    manager: idOf(value('manager')),
    validFrom,
    validTo,
  })
  if (overlapping) fail('custom:error:salarySchemeOverlap', { scheme: overlapping.name })

  return data
}

/** Схеми зарплати менеджерів, див. docs/accounting/design.md, розд. 2.5, 7.2. */
export const SalarySchemes: CollectionConfig = {
  slug: 'salary-schemes',
  labels: collectionLabels('custom:collection:salarySchemes:singular', 'custom:collection:salarySchemes:plural'),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
    useAsTitle: 'name',
    defaultColumns: ['name', 'manager', 'validFrom', 'validTo', 'percentBp', 'base'],
    listSearchableFields: ['name'],
    group: localized('custom:group:finance'),
  },
  defaultSort: '-validFrom',
  indexes: [{ fields: ['manager', 'validFrom'] }],
  hooks: {
    beforeChange: [validateScheme],
  },
  fields: [
    { name: 'name', label: label('custom:term:name'), type: 'text', required: true },
    managerField({
      name: 'manager',
      label: label('custom:term:manager'),
      admin: { description: description('custom:desc:salarySchemeManager') },
    }),
    {
      type: 'row',
      fields: [
        { name: 'validFrom', label: label('custom:field:validFrom'), type: 'date' },
        {
          name: 'validTo',
          label: label('custom:field:validTo'),
          type: 'date',
          admin: { description: description('custom:desc:salarySchemeValidTo') },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        moneyField({ name: 'fixedBani', label: label('custom:term:fixedSalary'), min: 0, defaultValue: 0 }),
        percentBpField({ name: 'percentBp', label: label('custom:term:percent'), required: true }),
      ],
    },
    {
      name: 'base',
      label: label('custom:term:accrualBase'),
      type: 'select',
      required: true,
      // В13: відсоток від виручки за датою проведення, знімок менеджера, місяць.
      defaultValue: 'revenue',
      options: [
        { label: label('custom:option:baseRevenue'), value: 'revenue' },
        { label: label('custom:option:baseGrossProfit'), value: 'gross_profit' },
        { label: label('custom:option:basePaidRevenue'), value: 'paid_revenue' },
      ],
      admin: { description: description('custom:desc:salarySchemePaidRevenue') },
    },
    {
      name: 'dateBasis',
      label: label('custom:field:dateBasis'),
      type: 'select',
      required: true,
      defaultValue: 'order_date',
      options: [
        { label: label('custom:option:dateBasisOrder'), value: 'order_date' },
        { label: label('custom:option:dateBasisPayment'), value: 'payment_date' },
      ],
    },
    {
      name: 'attribution',
      label: label('custom:field:attribution'),
      type: 'select',
      required: true,
      defaultValue: 'snapshot',
      options: [
        { label: label('custom:option:attributionSnapshot'), value: 'snapshot' },
        { label: label('custom:option:attributionCurrent'), value: 'current' },
      ],
    },
    {
      name: 'customerFilter',
      label: label('custom:field:customerFilter'),
      type: 'select',
      defaultValue: 'all',
      options: [
        { label: label('custom:option:customersAll'), value: 'all' },
        { label: label('custom:option:customersRetail'), value: 'retail' },
        { label: label('custom:option:customersWholesale'), value: 'wholesale' },
      ],
    },
    {
      name: 'period',
      label: label('custom:field:salaryPeriod'),
      type: 'select',
      defaultValue: 'month',
      options: [{ label: label('custom:option:periodMonth'), value: 'month' }],
    },
  ],
}
