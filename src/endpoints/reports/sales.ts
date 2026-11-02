import { customT } from '@/i18n'
import { createRestockTransfer, getSalesReport } from '@/services/reports/sales.service'

import { reportEndpoint, reportResponse } from './shared'

/** `GET /api/reports/sales?from&to&warehouse`: що продано зі складу за період (шт.), лише admin. */
export const salesReport = reportEndpoint('sales', async (req, params) => {
  const period = params.period()
  const warehouse = params.reference('warehouse', { required: true })
  await params.finish()

  return getSalesReport(req, period!, warehouse!)
})

/**
 * `POST /api/reports/sales/transfer?from&to&warehouse&source`: чернетка переміщення зі складу
 * `source` на `warehouse` з позиціями звіту продажів. 201 `{ id, number, lines }`; нічого не продано — 422.
 */
export const salesTransfer = reportEndpoint(
  'sales/transfer',
  async (req, params) => {
    const period = params.period()
    const warehouse = params.reference('warehouse', { required: true })
    const source = params.reference('source', { required: true })
    params.distinct('source', source, warehouse)
    await params.finish()

    const created = await createRestockTransfer(req, period!, warehouse!, source!)
    if (!created) {
      return reportResponse({ code: 'NOTHING_TO_TRANSFER', message: customT(req.t)('custom:error:reportNothingToTransfer') }, 422)
    }

    return reportResponse(created, 201)
  },
  'post',
)
