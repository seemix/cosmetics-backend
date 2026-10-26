import { getExpensesReport } from '@/services/reports/expenses.service'

import { reportEndpoint } from './shared'

/** `GET /api/reports/expenses?from&to[&category][&account][&page][&limit]`: витрати за період, лише admin. */
export const expensesReport = reportEndpoint('expenses', async (req, params) => {
  const period = params.period()
  const category = params.reference('category')
  const account = params.reference('account')
  const paging = params.paging()
  await params.finish()

  return getExpensesReport(req, period!, { category, account }, paging)
})
