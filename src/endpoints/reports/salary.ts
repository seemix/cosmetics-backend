import { getSalaryReport } from '@/services/reports/salary.service'

import { reportEndpoint } from './shared'

/** `GET /api/reports/salary?from&to[&manager]`: зарплата менеджерів за період, лише admin. */
export const salaryReport = reportEndpoint('salary', async (req, params) => {
  const period = params.period()
  const manager = params.reference('manager')
  await params.finish()

  return getSalaryReport(req, period!, { manager })
})
