'use client'

import type { MouseEvent } from 'react'
import { Button, useConfig, useTranslation } from '@payloadcms/ui'

import { customT } from '@/i18n/labels'

/** Кнопка біля статусу в списку замовлень: відкриває редагування цього замовлення. */
export const EditOrderLink = ({ id, className }: { id: string; className?: string }) => {
  const { config } = useConfig()
  const { t } = useTranslation()
  const label = customT(t)('custom:ordersList:editOrder')
  // Адмінка може стояти в корені (`routes.admin = '/'`), тоді без обрізання вийшло б `//collections/...`.
  const adminRoute = config.routes.admin.replace(/\/+$/, '')

  return (
    <Button
      el="link"
      to={`${adminRoute}/collections/orders/${encodeURIComponent(id)}`}
      className={className}
      buttonStyle="subtle"
      size="small"
      icon={['edit']}
      margin={false}
      aria-label={label}
      tooltip={label}
      extraButtonProps={{ onClick: (event: MouseEvent) => event.stopPropagation() }}
    />
  )
}
