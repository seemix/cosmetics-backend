'use client'

import { useState } from 'react'
import { Button, useAuth, useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'

import { customT } from '@/i18n/labels'

/** Кнопка «Прийняти оплату»: створює чернетку надходження по замовленню й відкриває її. */
export const AcceptPaymentButton = () => {
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const { config } = useConfig()
  const { t } = useTranslation()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const roles = (user as { roles?: string[] } | null)?.roles
  if (!id || !roles?.includes('admin')) return null

  const handleClick = async () => {
    setBusy(true)
    setError(null)

    try {
      const response = await fetch(`${config.routes.api}/orders/${id}/accept-payment`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const body = (await response.json()) as { id?: string; message?: string }

      if (!response.ok || !body.id) {
        setError(body.message ?? customT(t)('custom:orderForm:acceptPaymentFailed'))
        return
      }

      // Адмінка може стояти в корені (`routes.admin = '/'`), тоді без обрізання вийшло б `//collections/...`.
      const adminRoute = config.routes.admin.replace(/\/+$/, '')
      router.push(`${adminRoute}/collections/cash-operations/${body.id}`)
    } catch {
      setError(customT(t)('custom:orderForm:acceptPaymentFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <Button buttonStyle="primary" disabled={busy} onClick={handleClick} size="medium">
        {customT(t)('custom:orderForm:acceptPayment')}
      </Button>
      <p style={{ margin: '4px 0 0', color: 'var(--theme-elevation-500)' }}>
        {customT(t)('custom:orderForm:acceptPaymentHint')}
      </p>
      {error && (
        <p role="alert" style={{ margin: '4px 0 0', color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
