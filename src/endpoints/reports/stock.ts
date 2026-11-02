import { getStockReport, STOCK_SORTS } from '@/services/reports/stock.service'

import { reportEndpoint } from './shared'

/** `GET /api/reports/stock[?warehouse][&q][&onlyPositive][&sort][&page][&limit]`: залишки й вартість, лише admin. */
export const stockReport = reportEndpoint('stock', async (req, params) => {
  const warehouse = params.reference('warehouse')
  const q = params.text('q')
  const onlyPositive = params.bool('onlyPositive', true)
  const sort = params.oneOf('sort', STOCK_SORTS, 'title')
  const paging = params.paging()
  await params.finish()

  return getStockReport(req, { warehouse, q, onlyPositive, sort }, paging)
})
