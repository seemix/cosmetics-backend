import { getDebtsReport } from '@/services/reports/debts.service'

import { reportEndpoint } from './shared'

/**
 * `GET /api/reports/debts[?asOf][&includeZero][&page][&limit]`: борги постачальникам, менеджерам і
 * покупців, лише admin. `page`/`limit` пагінують секцію покупців; `asOf` на покупців не діє.
 */
export const debtsReport = reportEndpoint('debts', async (req, params) => {
  const asOf = params.asOf()
  const includeZero = params.bool('includeZero', false)
  const paging = params.paging()
  await params.finish()

  return getDebtsReport(req, { asOf, includeZero }, paging)
})
