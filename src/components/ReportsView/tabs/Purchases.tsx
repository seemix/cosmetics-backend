'use client'

import type { PurchasesReport } from '@/services/reports/purchases.service'

import { Count, DataTable, DateText, DocLink, Money, Pager, Section, StatusText, Summary, useReports } from '../parts/Ui'

export const PurchasesTab = ({ data, onPage }: { data: PurchasesReport; onPage: (page: number) => void }) => {
  const { t } = useReports()

  return (
    <>
      <Section title={t('custom:reports:sectionTotals')}>
        <Summary
          rows={[
            { label: t('custom:reports:purchasesCount'), count: data.totals.count },
            { label: t('custom:reports:purchasesGoods'), bani: data.totals.goodsTotalBani },
            { label: t('custom:reports:purchasesExtra'), bani: data.totals.extraTotalBani },
            { label: t('custom:reports:purchasesLanded'), bani: data.totals.landedTotalBani, strong: true },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:bySupplier')}>
        <DataTable
          caption={t('custom:reports:bySupplier')}
          rows={data.bySupplier}
          rowKey={(row, index) => row.supplier ?? `none-${index}`}
          columns={[
            { header: t('custom:term:supplier'), cell: (row) => row.name ?? '—' },
            { header: t('custom:reports:purchasesCount'), numeric: true, cell: (row) => <Count value={row.count} /> },
            { header: t('custom:reports:purchasesGoods'), numeric: true, cell: (row) => <Money bani={row.goodsTotalBani} /> },
            { header: t('custom:reports:purchasesExtra'), numeric: true, cell: (row) => <Money bani={row.extraTotalBani} /> },
            { header: t('custom:reports:purchasesLanded'), numeric: true, cell: (row) => <Money bani={row.landedTotalBani} /> },
          ]}
        />
      </Section>
      <Section title={t('custom:reports:purchasesList')}>
        <DataTable
          caption={t('custom:reports:purchasesList')}
          rows={data.items}
          rowKey={(row) => row.id}
          columns={[
            { header: t('custom:term:number'), cell: (row) => <DocLink collection="purchases" id={row.id}>{row.number ?? row.id}</DocLink> },
            { header: t('custom:term:supplier'), cell: (row) => row.supplier?.name ?? '—' },
            { header: t('custom:reports:supplierInvoiceNo'), cell: (row) => row.supplierInvoiceNo ?? '—' },
            { header: t('custom:term:warehouse'), cell: (row) => row.warehouse?.name ?? '—' },
            { header: t('custom:reports:colPostedAt'), cell: (row) => <DateText iso={row.postedAt} /> },
            { header: t('custom:term:status'), cell: (row) => <StatusText status={row.status} /> },
            { header: t('custom:reports:purchasesGoods'), numeric: true, cell: (row) => <Money bani={row.goodsTotalBani} /> },
            { header: t('custom:reports:purchasesExtra'), numeric: true, cell: (row) => <Money bani={row.extraTotalBani} /> },
            { header: t('custom:reports:purchasesLanded'), numeric: true, cell: (row) => <Money bani={row.landedTotalBani} /> },
          ]}
        />
        <Pager pagination={data.pagination} onPage={onPage} />
      </Section>
    </>
  )
}
