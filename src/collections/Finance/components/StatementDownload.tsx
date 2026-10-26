'use client'

import { useState } from 'react'
import { Button, useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'

import { customT } from '@/i18n/labels'

/** Календарний день `YYYY-MM-DD` за годинником браузера. */
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const fileName = (disposition: string | null) => {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  if (encoded) return decodeURIComponent(encoded)

  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'statement.xlsx'
}

/** Виписка по клієнту за період: дати й кнопка завантаження .xlsx (розд. 6.5). */
export const StatementDownload = () => {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const { t } = useTranslation()
  const tr = customT(t)
  const today = new Date()
  const [from, setFrom] = useState(localDay(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(localDay(today))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!id) return null

  const handleClick = async () => {
    if (!from || !to || from > to) {
      setError(tr('custom:statement:invalidPeriod'))
      return
    }

    setBusy(true)
    setError(null)

    try {
      const query = new URLSearchParams({ from, to })
      const response = await fetch(`${config.routes.api}/customer-balances/${id}/statement?${query}`, {
        credentials: 'same-origin',
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        setError(body.message ?? response.statusText)
        return
      }

      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = fileName(response.headers.get('Content-Disposition'))
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <h4 style={{ margin: '0 0 8px' }}>{tr('custom:statement:title')}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tr('custom:statement:from')}
          <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tr('custom:statement:to')}
          <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
        <Button buttonStyle="primary" disabled={busy} onClick={handleClick} size="medium" margin={false}>
          {busy ? tr('custom:statement:downloading') : tr('custom:statement:download')}
        </Button>
      </div>
      {error && (
        <p role="alert" style={{ margin: '4px 0 0', color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
