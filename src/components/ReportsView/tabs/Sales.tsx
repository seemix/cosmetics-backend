'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { SalesReport } from '@/services/reports/sales.service'

import type { ViewState } from '../lib/urlState'
import { OptionSelect } from '../parts/Filters'
import { Count, DataTable, Section, useReports, type Column } from '../parts/Ui'

type Row = SalesReport['items'][number]

/**
 * Поповнення складу: чернетка переміщення з обраного складу на склад звіту з тими самими позиціями й
 * кількостями. Рядки сервер рахує заново за тими самими параметрами; після створення відкривається документ.
 */
const RestockTransfer = ({ state }: { state: ViewState }) => {
  const { t, apiRoute, adminRoute } = useReports()
  const router = useRouter()
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    const query = new URLSearchParams({ from: state.from, to: state.to, warehouse: state.warehouse, source })

    try {
      const response = await fetch(`${apiRoute}/reports/sales/transfer?${query}`, { method: 'POST', credentials: 'include' })
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string }

      if (response.ok && body.id) {
        router.push(`${adminRoute === '/' ? '' : adminRoute}/collections/stock-transfers/${body.id}`)
        return
      }
      setError(body.message ?? t('custom:reports:salesTransferFailed'))
    } catch {
      setError(t('custom:reports:salesTransferFailed'))
    }
    setBusy(false)
  }

  const disabled = busy || !source || source === state.warehouse

  return (
    <Section title={t('custom:reports:salesRestock')} hint={t('custom:reports:salesRestockHint')}>
      <div className="reports__filters">
        <OptionSelect name="warehouse" label={t('custom:reports:salesSource')} value={source} onChange={setSource} />
        <button type="button" className="reports__btn" disabled={disabled} onClick={create}>
          {t(busy ? 'custom:reports:salesCreating' : 'custom:reports:salesCreateTransfer')}
        </button>
      </div>
      {source && source === state.warehouse && (
        <p className="reports__muted">
          {t('custom:reports:salesSource')}: {t('custom:reports:reasonSame')}
        </p>
      )}
      {error && (
        <p className="reports__error" role="alert">
          {error}
        </p>
      )}
    </Section>
  )
}

export const SalesTab = ({ data, state }: { data: SalesReport; state: ViewState }) => {
  const { t } = useReports()

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
    { header: t('custom:reports:colSoldQty'), numeric: true, cell: (row) => <Count value={row.soldQty} /> },
  ]

  return (
    <>
      <DataTable
        caption={t('custom:reports:tabSales')}
        columns={columns}
        rows={data.items}
        rowKey={(row) => row.product.id}
        footer={[t('custom:reports:salesTotal', { count: String(data.totals.count) }), <Count key="qty" value={data.totals.soldQty} />]}
      />
      {data.items.length > 0 && <RestockTransfer state={state} />}
    </>
  )
}
