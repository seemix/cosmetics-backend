import type { Access, CollectionConfig, Where } from 'payload'

import { adminOnly } from '@/access/adminOnly'
import { hiddenUnlessAdmin, isAdmin, isManager } from '@/access/isAdmin'
import { collectionLabels, description, label, localized } from '@/i18n'

/** `filterOptions` для relationship-полів на `expense-categories` у документах: лише активні статті. */
export const activeExpenseCategoriesOnly: Where = { isActive: { equals: true } }

/** В19: manager бачить статті для своїх витрат, тобто всі, крім статей зарплати. */
const readCategories: Access = ({ req: { user } }) => {
  if (isAdmin(user)) return true
  if (isManager(user)) return { isSalary: { not_equals: true } }
  return false
}

/** Статті витрат, див. docs/accounting/design.md, розд. 2.1. */
export const ExpenseCategories: CollectionConfig = {
  slug: 'expense-categories',
  labels: collectionLabels(
    'custom:collection:expenseCategories:singular',
    'custom:collection:expenseCategories:plural',
  ),
  access: {
    read: readCategories,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    hidden: hiddenUnlessAdmin,
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
