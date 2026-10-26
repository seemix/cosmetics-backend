import { getProfitReport } from '@/services/reports/profit.service'

import { reportEndpoint } from './shared'

/** `GET /api/reports/profit?from&to`: прибуток за період (розд. 12), лише admin. */
export const profitReport = reportEndpoint('profit', async (req, params) => {
  const period = params.period()
  await params.finish()

  return getProfitReport(req, period!)
})
