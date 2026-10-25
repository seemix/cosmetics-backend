import type { CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { collectionLabels, description, label, localized } from '@/i18n'

/** `filterOptions` для relationship-полів на `expense-categories` у документах: лише активні статті. */
export const activeExpenseCategoriesOnly: Where = { isActive: { equals: true } }

/** Статті витрат, див. docs/accounting/design.md, розд. 2.1. */
export const ExpenseCategories: CollectionConfig = {
  slug: 'expense-categories',
  labels: collectionLabels(
    'custom:collection:expenseCategories:singular',
    'custom:collection:expenseCategories:plural',
  ),
  access: {
    read: adminOnly,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'code', 'isSalary', 'isActive'],
    listSearchableFields: ['name', 'code'],
    group: localized('custom:group:finance'),
  },
  defaultSort: 'name',
  fields: [
    { name: 'name', label: label('custom:term:name'), type: 'text', required: true },
    { name: 'code', label: label('custom:field:code'), type: 'text', required: true, unique: true, index: true },
    {
      name: 'isSalary',
      label: label('custom:field:isSalary'),
      type: 'checkbox',
      defaultValue: false,
      admin: { description: description('custom:desc:salaryCategory') },
    },
    {
      name: 'isActive',
      label: label('custom:field:isActive'),
      type: 'checkbox',
      defaultValue: true,
      admin: { description: description('custom:desc:inactiveExpenseCategory') },
    },
  ],
}
