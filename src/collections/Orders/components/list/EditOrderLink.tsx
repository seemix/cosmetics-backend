'use client'

import { Pencil } from 'lucide-react'
import Link from 'next/link'
import { useConfig, useTranslation } from '@payloadcms/ui'

import { customT } from '@/i18n/labels'

/** Іконка біля статусу в списку замовлень: відкриває редагування цього замовлення. */
export const EditOrderLink = ({ id, className }: { id: string; className?: string }) => {
  const { config } = useConfig()
  const { t } = useTranslation()
  const label = customT(t)('custom:ordersList:editOrder')
  // Адмінка може стояти в корені (`routes.admin = '/'`), тоді без обрізання вийшло б `//collections/...`.
  const adminRoute = config.routes.admin.replace(/\/+$/, '')

  return (
    <Link
      href={`${adminRoute}/collections/orders/${encodeURIComponent(id)}`}
      className={className}
      title={label}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
    >
      <Pencil size={14} aria-hidden="true" />
    </Link>
  )
}
