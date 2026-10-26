'use client'

import type { StockReport } from '@/services/reports/stock.service'

import { Count, DataTable, Money, Pager, useReports, type Column } from '../parts/Ui'

type Row = StockReport['items'][number]

export const StockTab = ({ data, onPage }: { data: StockReport; onPage: (page: number) => void }) => {
  const { t } = useReports()

  // Склади в колонках: ті, що трапились на поточній сторінці, за кодом.
  const warehouses = new Map<string, string>()
  for (const item of data.items) {
    for (const entry of item.qtyByWarehouse) warehouses.set(entry.warehouse, entry.code ?? entry.warehouse)
  }
  const ordered = [...warehouses.entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const columns: Column<Row>[] = [
    {
      header: t('custom:term:product'),
      cell: (row) => (
        <>
          {row.product.title ?? '—'}
          {row.product.article && <small className="reports__muted reports__block">{row.product.article}</small>}
        </>
      ),
    },
    ...ordered.map(([id, code]) => ({
      header: code,
      numeric: true,
      cell: (row: Row) => {
        const entry = row.qtyByWarehouse.find((item) => item.warehouse === id)

        return entry ? <Count value={entry.qty} /> : '—'
      },
    })),
    { header: t('custom:term:quantity'), numeric: true, cell: (row) => <Count value={row.totalQty} /> },
    { header: t('custom:reports:colValue'), numeric: true, cell: (row) => <Money bani={row.valueBani} /> },
    { header: t('custom:reports:colAvgCost'), numeric: true, cell: (row) => <Money bani={Math.round(row.avgCostBani)} /> },
  ]

  return (
    <>
      <DataTable
        caption={t('custom:reports:tabStock')}
        columns={columns}
        rows={data.items}
        rowKey={(row) => row.product.id}
        footer={[
          t('custom:reports:totalAllPages', { count: String(data.totals.count) }),
          ...ordered.map(() => ''),
          <Count key="qty" value={data.totals.totalQty} />,
          <Money key="value" bani={data.totals.totalValueBani} strong />,
          '',
        ]}
      />
      <Pager pagination={data.pagination} onPage={onPage} />
    </>
  )
}
