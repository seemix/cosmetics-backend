'use client'

import type { SalaryReport } from '@/services/reports/salary.service'

import { DataTable, DateText, DebtAmount, DocLink, Money, Section, StatusText, Summary, useReports } from '../parts/Ui'

export const SalaryTab = ({ data }: { data: SalaryReport }) => {
  const { t } = useReports()
  const payrolls = data.managers.flatMap((row) => row.payrolls.map((payroll) => ({ ...payroll, managerName: row.name })))

  return (
    <>
      <Section title={t('custom:reports:sectionTotals')}>
        <Summary
          rows={[
            { label: t('custom:reports:colAccrued'), bani: data.totals.accruedBani },
            { label: t('custom:reports:colPaidInPeriod'), bani: data.totals.paidInPeriodBani },
            { label: t('custom:reports:colSalaryDebt'), bani: data.totals.debtBani, strong: true },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:salaryByManager')} hint={t('custom:reports:hintWeOwe')}>
        <DataTable
          caption={t('custom:reports:salaryByManager')}
          rows={data.managers}
          rowKey={(row) => row.manager}
          columns={[
            { header: t('custom:term:manager'), cell: (row) => <DocLink collection="users" id={row.manager}>{row.name ?? row.manager}</DocLink> },
            { header: t('custom:reports:colAccrued'), numeric: true, cell: (row) => <Money bani={row.accruedBani} /> },
            { header: t('custom:reports:colPaidInPeriod'), numeric: true, cell: (row) => <Money bani={row.paidInPeriodBani} /> },
            { header: t('custom:reports:colSalaryDebt'), numeric: true, cell: (row) => <DebtAmount kind="weOwe" bani={row.debtBani} /> },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:payrollsList')}>
        <DataTable
          caption={t('custom:reports:payrollsList')}
          rows={payrolls}
          rowKey={(row) => row.id}
          columns={[
            { header: t('custom:term:payroll'), cell: (row) => <DocLink collection="payrolls" id={row.id}>{row.number ?? row.id}</DocLink> },
            { header: t('custom:term:manager'), cell: (row) => row.managerName ?? '—' },
            {
              header: t('custom:reports:colPeriod'),
              cell: (row) => (
                <>
                  <DateText iso={row.periodFrom} /> – <DateText iso={row.periodTo} />
                </>
              ),
            },
            { header: t('custom:term:status'), cell: (row) => <StatusText status={row.status} /> },
            { header: t('custom:reports:colAccrued'), numeric: true, cell: (row) => <Money bani={row.totalBani} /> },
            { header: t('custom:reports:colPaid'), numeric: true, cell: (row) => <Money bani={row.paidBani} /> },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:cancelledAfterPayroll')} hint={t('custom:reports:hintCancelled')}>
        <DataTable
          caption={t('custom:reports:cancelledAfterPayroll')}
          rows={data.cancelledAfterPayroll.items}
          rowKey={(row) => `${row.order}-${row.payroll}`}
          columns={[
            { header: t('custom:reports:colOrder'), cell: (row) => <DocLink collection="orders" id={row.order}>{row.number ?? row.order}</DocLink> },
            { header: t('custom:term:payroll'), cell: (row) => <DocLink collection="payrolls" id={row.payroll}>{row.payrollNumber ?? row.payroll}</DocLink> },
            { header: t('custom:term:manager'), cell: (row) => row.managerName ?? '—' },
            { header: t('custom:term:amount'), numeric: true, cell: (row) => <Money bani={row.amountBani} /> },
          ]}
          footer={['', '', t('custom:term:total'), <Money key="total" bani={data.cancelledAfterPayroll.totalBani} strong />]}
        />
      </Section>
    </>
  )
}
