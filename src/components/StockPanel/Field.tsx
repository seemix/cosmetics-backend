'use client'

import { useEffect, useState } from 'react'
import { useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import type { UIFieldClientComponent } from 'payload'

import type { ProductStock } from '@/endpoints/getProductStock'
import type { CustomTranslationsKeys } from '@/i18n'
import { customT } from '@/i18n/labels'
import { formatMDL } from '@/utilities/money'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: CustomTranslationsKeys }
  | { status: 'ready'; stock: ProductStock }

const cell: React.CSSProperties = { padding: '4px 12px 4px 0', textAlign: 'left' }
const numeric: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

/** Залишки по складах і середня собівартість товару. Лише перегляд, у документ нічого не пише. */
export const StockPanel: UIFieldClientComponent = () => {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const { t: rawT } = useTranslation()
  const t = customT(rawT)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!id) return

    const controller = new AbortController()
    setState({ status: 'loading' })

    fetch(`${config.routes.api}/stock/product/${id}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setState({
            status: 'error',
            message: response.status === 403 ? 'custom:stockPanel:noAccess' : 'custom:stockPanel:loadFailed',
          })
          return
        }
        setState({ status: 'ready', stock: (await response.json()) as ProductStock })
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', message: 'custom:stockPanel:loadFailed' })
      })

    return () => controller.abort()
  }, [id, config.routes.api])

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <h4 style={{ margin: '0 0 8px' }}>{t('custom:stockPanel:title')}</h4>
      {!id && <p>{t('custom:stockPanel:saveFirst')}</p>}
      {id && state.status === 'loading' && <p>{t('custom:stockPanel:loading')}</p>}
      {id && state.status === 'error' && <p role="alert">{t(state.message)}</p>}
      {id && state.status === 'ready' && <StockTable stock={state.stock} />}
    </div>
  )
}

const StockTable = ({ stock }: { stock: ProductStock }) => {
  const { t: rawT } = useTranslation()
  const t = customT(rawT)

  if (stock.warehouses.length === 0) return <p>{t('custom:stockPanel:empty')}</p>

  return (
    <table style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={cell}>{t('custom:term:warehouse')}</th>
          <th style={numeric}>{t('custom:term:quantity')}</th>
        </tr>
      </thead>
      <tbody>
        {stock.warehouses.map((warehouse) => (
          <tr key={warehouse.id}>
            <td style={cell}>{warehouse.name}</td>
            <td style={numeric}>{warehouse.qty}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...cell, fontWeight: 600 }}>{t('custom:term:total')}</td>
          <td style={{ ...numeric, fontWeight: 600 }}>{stock.totalQty}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td style={cell}>{t('custom:stockPanel:avgCost')}</td>
          <td style={numeric}>{stock.avgCostBani > 0 ? `${formatMDL(Math.round(stock.avgCostBani))} MDL` : '—'}</td>
        </tr>
        <tr>
          <td style={cell}>{t('custom:stockPanel:stockValue')}</td>
          <td style={numeric}>{formatMDL(stock.valueBani)} MDL</td>
        </tr>
        {stock.lastPurchaseUnitCostBani !== null && (
          <tr>
            <td style={cell}>{t('custom:stockPanel:lastPurchaseCost')}</td>
            <td style={numeric}>{formatMDL(Math.round(stock.lastPurchaseUnitCostBani))} MDL</td>
          </tr>
        )}
      </tfoot>
    </table>
  )
}
