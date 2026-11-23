'use client'

import { useState } from 'react'
import { Button, Tooltip, useAuth, useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { Info } from 'lucide-react'
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
  const [hintVisible, setHintVisible] = useState(false)

  const roles = (user as { roles?: string[] } | null)?.roles
  if (!id || !(roles?.includes('admin') || roles?.includes('manager'))) return null

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

  const hint = customT(t)('custom:orderForm:acceptPaymentHint')

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <span
        aria-label={hint}
        onBlur={() => setHintVisible(false)}
        onFocus={() => setHintVisible(true)}
        onMouseEnter={() => setHintVisible(true)}
        onMouseLeave={() => setHintVisible(false)}
        style={{ color: 'var(--theme-elevation-500)', cursor: 'help', display: 'inline-flex', position: 'relative' }}
        tabIndex={0}
      >
        <Info aria-hidden="true" size={16} />
        <Tooltip alignCaret="left" delay={0} show={hintVisible}>
          <span>{hint}</span>
        </Tooltip>
      </span>
      <Button buttonStyle="primary" disabled={busy} onClick={handleClick} size="medium">
        {customT(t)('custom:orderForm:acceptPayment')}
      </Button>
      {error && (
        <span role="alert" style={{ color: 'var(--theme-error-500)' }}>
          {error}
        </span>
      )}
    </span>
  )
}
