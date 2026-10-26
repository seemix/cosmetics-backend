'use client'

import type { ProfitReport } from '@/services/reports/profit.service'

import { Count, DataTable, Money, Section, Summary, useReports } from '../parts/Ui'

export const ProfitTab = ({ data }: { data: ProfitReport }) => {
  const { t } = useReports()

  return (
    <>
      <p className="reports__muted">{t('custom:reports:profitMethod')}</p>
      <Section title={t('custom:reports:profitCalc')}>
        <Summary
          rows={[
            { label: t('custom:term:revenue'), bani: data.revenueBani },
            { label: t('custom:term:cogs'), bani: data.cogsBani },
            { label: t('custom:term:grossProfit'), bani: data.grossProfitBani, strong: true },
            { label: t('custom:term:warehouseLosses'), bani: data.warehouseLossesBani },
            { label: t('custom:term:expenses'), bani: data.expensesBani },
            { label: t('custom:term:profit'), bani: data.profitBani, strong: true },
          ]}
        />
        <p className="reports__muted">
          {t('custom:reports:profitOrders')}: <Count value={data.ordersCount} /> · {t('custom:reports:profitSalaryIncluded')}:{' '}
          <Money bani={data.salaryExpensesBani} />
        </p>
      </Section>
      <Section title={t('custom:reports:expensesByCategory')}>
        <DataTable
          caption={t('custom:reports:expensesByCategory')}
          rows={data.expensesByCategory}
          rowKey={(row, index) => row.category ?? `none-${index}`}
          columns={[
            {
              header: t('custom:reports:colCategory'),
              cell: (row) => (
                <>
                  {row.name ?? '—'}
                  {row.isSalary && <small className="reports__muted"> · {t('custom:reports:salaryMark')}</small>}
                </>
              ),
            },
            { header: t('custom:reports:colOperations'), numeric: true, cell: (row) => <Count value={row.count} /> },
            { header: t('custom:term:amount'), numeric: true, cell: (row) => <Money bani={row.totalBani} /> },
          ]}
          footer={[t('custom:term:total'), '', <Money key="total" bani={data.expensesBani} strong />]}
        />
      </Section>
    </>
  )
}
