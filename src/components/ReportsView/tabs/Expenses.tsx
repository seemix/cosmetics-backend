'use client'

import type { ExpensesReport } from '@/services/reports/expenses.service'

import { Count, DataTable, DateText, DocLink, Money, Pager, Section, Summary, useReports } from '../parts/Ui'

export const ExpensesTab = ({ data, onPage }: { data: ExpensesReport; onPage: (page: number) => void }) => {
  const { t } = useReports()

  return (
    <>
      <Section title={t('custom:reports:sectionTotals')}>
        <Summary
          rows={[
            { label: t('custom:reports:colOperations'), count: data.count },
            { label: t('custom:term:total'), bani: data.totalBani, strong: true },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:expensesByCategory')}>
        <DataTable
          caption={t('custom:reports:expensesByCategory')}
          rows={data.byCategory}
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
        />
      </Section>
      <Section title={t('custom:reports:byAccount')}>
        <DataTable
          caption={t('custom:reports:byAccount')}
          rows={data.byAccount}
          rowKey={(row, index) => row.account ?? `none-${index}`}
          columns={[
            { header: t('custom:term:cashAccount'), cell: (row) => row.name ?? '—' },
            { header: t('custom:reports:colOperations'), numeric: true, cell: (row) => <Count value={row.count} /> },
            { header: t('custom:term:amount'), numeric: true, cell: (row) => <Money bani={row.totalBani} /> },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:expensesList')}>
        <DataTable
          caption={t('custom:reports:expensesList')}
          rows={data.items}
          rowKey={(row) => row.id}
          columns={[
            { header: t('custom:term:number'), cell: (row) => <DocLink collection="cash-operations" id={row.id}>{row.number ?? row.id}</DocLink> },
            { header: t('custom:term:date'), cell: (row) => <DateText iso={row.operationDate} /> },
            { header: t('custom:reports:colCategory'), cell: (row) => row.category?.name ?? '—' },
            { header: t('custom:term:cashAccount'), cell: (row) => row.account?.name ?? '—' },
            { header: t('custom:term:supplier'), cell: (row) => row.supplier?.name ?? '—' },
            { header: t('custom:term:manager'), cell: (row) => row.manager?.name ?? '—' },
            { header: t('custom:term:amount'), numeric: true, cell: (row) => <Money bani={row.amountBani} /> },
          ]}
        />
        <Pager pagination={data.pagination} onPage={onPage} />
      </Section>
    </>
  )
}
