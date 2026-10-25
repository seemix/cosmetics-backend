import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// C1: довідники фінансів. Сидимо каси `cash`, `bank` і статті витрат (розд. 2.1 дизайну).
// Баланси стартують з 0 і змінюються лише проведенням початкових залишків.
const ACCOUNTS = [
  { code: 'cash', name: 'Cash', kind: 'cash' },
  { code: 'bank', name: 'Company account', kind: 'bank' },
] as const

const CATEGORIES = [
  { code: 'rent', name: 'Rent', isSalary: false },
  { code: 'hosting', name: 'Hosting', isSalary: false },
  { code: 'salary', name: 'Salary', isSalary: true },
  { code: 'advertising', name: 'Advertising', isSalary: false },
  { code: 'bank-fees', name: 'Bank fees', isSalary: false },
  { code: 'other', name: 'Other', isSalary: false },
] as const

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  for (const account of ACCOUNTS) {
    const existing = await payload.count({ collection: 'cash-accounts', where: { code: { equals: account.code } }, req })
    if (existing.totalDocs === 0) {
      await payload.create({
        collection: 'cash-accounts',
        data: { ...account, allowNegative: false, isActive: true },
        req,
      })
    }
  }

  for (const category of CATEGORIES) {
    const existing = await payload.count({
      collection: 'expense-categories',
      where: { code: { equals: category.code } },
      req,
    })
    if (existing.totalDocs === 0) {
      await payload.create({ collection: 'expense-categories', data: { ...category, isActive: true }, req })
    }
  }

  payload.logger.info('finance: seeded cash accounts (cash, bank) and expense categories')
}

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  await payload.delete({
    collection: 'cash-accounts',
    where: { code: { in: ACCOUNTS.map((account) => account.code) } },
    req,
  })
  await payload.delete({
    collection: 'expense-categories',
    where: { code: { in: CATEGORIES.map((category) => category.code) } },
    req,
  })
  payload.logger.info('finance: removed cash accounts and expense categories')
}
