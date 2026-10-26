import { getPurchasesReport } from '@/services/reports/purchases.service'

import { reportEndpoint } from './shared'

/** `GET /api/reports/purchases?from&to[&supplier][&page][&limit]`: закупівлі за період, лише admin. */
export const purchasesReport = reportEndpoint('purchases', async (req, params) => {
  const period = params.period()
  const supplier = params.reference('supplier')
  const paging = params.paging()
  await params.finish()

  return getPurchasesReport(req, period!, { supplier }, paging)
})
