'use client'

import { useEffect, useState } from 'react'
import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import type { UIFieldClientComponent } from 'payload'

import type { ProductStock } from '@/endpoints/getProductStock'
import { formatMDL } from '@/utilities/money'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; stock: ProductStock }

const cell: React.CSSProperties = { padding: '4px 12px 4px 0', textAlign: 'left' }
const numeric: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

/** Залишки по складах і середня собівартість товару. Лише перегляд, у документ нічого не пише. */
export const StockPanel: UIFieldClientComponent = () => {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!id) return

    const controller = new AbortController()
    setState({ status: 'loading' })

    fetch(`${config.routes.api}/stock/product/${id}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? 'No access to stock data' : 'Failed to load stock')
        setState({ status: 'ready', stock: (await response.json()) as ProductStock })
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState({ status: 'error', message: error.message })
      })

    return () => controller.abort()
  }, [id, config.routes.api])

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <h4 style={{ margin: '0 0 8px' }}>Stock</h4>
      {!id && <p>Save the product to see its stock.</p>}
      {id && state.status === 'loading' && <p>Loading…</p>}
      {id && state.status === 'error' && <p role="alert">{state.message}</p>}
      {id && state.status === 'ready' && <StockTable stock={state.stock} />}
    </div>
  )
}

const StockTable = ({ stock }: { stock: ProductStock }) => {
  if (stock.warehouses.length === 0) return <p>No stock records yet.</p>

  return (
    <table style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={cell}>Warehouse</th>
          <th style={numeric}>Quantity</th>
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
          <td style={{ ...cell, fontWeight: 600 }}>Total</td>
          <td style={{ ...numeric, fontWeight: 600 }}>{stock.totalQty}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td style={cell}>Average cost</td>
          <td style={numeric}>{stock.avgCostBani > 0 ? `${formatMDL(Math.round(stock.avgCostBani))} MDL` : '—'}</td>
        </tr>
        <tr>
          <td style={cell}>Stock value</td>
          <td style={numeric}>{formatMDL(stock.valueBani)} MDL</td>
        </tr>
        {stock.lastPurchaseUnitCostBani !== null && (
          <tr>
            <td style={cell}>Last purchase cost</td>
            <td style={numeric}>{formatMDL(Math.round(stock.lastPurchaseUnitCostBani))} MDL</td>
          </tr>
        )}
      </tfoot>
    </table>
  )
}
