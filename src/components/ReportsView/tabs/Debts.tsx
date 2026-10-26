'use client'

import type { DebtsReport } from '@/services/reports/debts.service'

import { Count, DataTable, DebtAmount, DocLink, Money, Pager, Section, useReports } from '../parts/Ui'

export const DebtsTab = ({ data, onPage }: { data: DebtsReport; onPage: (page: number) => void }) => {
  const { t } = useReports()

  return (
    <>
      <Section title={t('custom:reports:debtsSuppliers')} hint={t('custom:reports:hintWeOwe')}>
        <DataTable
          caption={t('custom:reports:debtsSuppliers')}
          rows={data.suppliers.items}
          rowKey={(row) => row.supplier}
          columns={[
            { header: t('custom:term:supplier'), cell: (row) => <DocLink collection="suppliers" id={row.supplier}>{row.name ?? row.supplier}</DocLink> },
            { header: t('custom:reports:purchasesGoods'), numeric: true, cell: (row) => <Money bani={row.goodsBani} /> },
            { header: t('custom:reports:purchasesExtra'), numeric: true, cell: (row) => <Money bani={row.extraBani} /> },
            { header: t('custom:reports:colOpening'), numeric: true, cell: (row) => <Money bani={row.openingBani} /> },
            { header: t('custom:reports:colPaid'), numeric: true, cell: (row) => <Money bani={row.paidBani} /> },
            { header: t('custom:reports:colWeOwe'), numeric: true, cell: (row) => <DebtAmount kind="weOwe" bani={row.weOweBani} /> },
          ]}
          footer={['', '', '', '', t('custom:term:total'), <DebtAmount key="total" kind="weOwe" bani={data.suppliers.totalBani} />]}
        />
      </Section>

      <Section title={t('custom:reports:debtsCustomers')} hint={t('custom:reports:hintOwedToUs')}>
        {data.customersAsOf === 'current' && <p className="reports__badge">{t('custom:reports:customersCurrent')}</p>}
        <DataTable
          caption={t('custom:reports:debtsCustomers')}
          rows={data.customers.items}
          rowKey={(row, index) => row.customer ?? `guests-${index}`}
          columns={[
            {
              header: t('custom:reports:colCustomer'),
              cell: (row) =>
                row.customer ? (
                  <DocLink collection="users" id={row.customer}>{row.name ?? row.email ?? row.customer}</DocLink>
                ) : (
                  t('custom:reports:guests')
                ),
            },
            { header: 'Email', cell: (row) => row.email ?? '—' },
            {
              header: t('custom:reports:colOrders'),
              numeric: true,
              cell: (row) => (
                <details>
                  <summary>
                    <Count value={row.ordersCount} />
                  </summary>
                  <ul className="reports__orders">
                    {row.orders.map((order) => (
                      <li key={order.order}>
                        <DocLink collection="orders" id={order.order}>{order.number ?? order.order}</DocLink>
                        {': '}
                        <Money bani={order.owedToUsBani} />
                      </li>
                    ))}
                  </ul>
                </details>
              ),
            },
            { header: t('custom:reports:colOwedToUs'), numeric: true, cell: (row) => <DebtAmount kind="owedToUs" bani={row.owedToUsBani} /> },
          ]}
          footer={['', '', t('custom:term:total'), <DebtAmount key="total" kind="owedToUs" bani={data.customers.totalBani} />]}
        />
        <Pager pagination={data.customers.pagination} onPage={onPage} />
      </Section>

      <Section title={t('custom:reports:debtsManagers')} hint={t('custom:reports:hintWeOwe')}>
        <DataTable
          caption={t('custom:reports:debtsManagers')}
          rows={data.managers.items}
          rowKey={(row) => row.manager}
          columns={[
            { header: t('custom:term:manager'), cell: (row) => <DocLink collection="users" id={row.manager}>{row.name ?? row.manager}</DocLink> },
            { header: t('custom:reports:colAccrued'), numeric: true, cell: (row) => <Money bani={row.accruedBani} /> },
            { header: t('custom:reports:colPaid'), numeric: true, cell: (row) => <Money bani={row.paidBani} /> },
            { header: t('custom:reports:colWeOwe'), numeric: true, cell: (row) => <DebtAmount kind="weOwe" bani={row.weOweBani} /> },
          ]}
          footer={['', '', t('custom:term:total'), <DebtAmount key="total" kind="weOwe" bani={data.managers.totalBani} />]}
        />
      </Section>
    </>
  )
}
