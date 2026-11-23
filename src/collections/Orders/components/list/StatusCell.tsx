import type { DefaultServerCellComponentProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import type { ComponentProps } from 'react'

import { customT } from '@/i18n/labels'
import styles from './StatusCell.module.css'

type PillStyle = NonNullable<ComponentProps<typeof Pill>['pillStyle']>

const STATUS_STYLE: Record<string, PillStyle> = {
  pending: 'warning',
  backorder: 'error',
  paid: 'success',
  shipped: 'success',
  cancelled: 'light-gray',
}

type Status = 'pending' | 'backorder' | 'paid' | 'shipped' | 'cancelled'

/** Клітинка статусу замовлення: кольорова мітка. */
export const OrderStatusCell = ({ cellData, i18n }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'string' || !(cellData in STATUS_STYLE)) return <span>—</span>

  const isShipped = cellData === 'shipped'
  const className = isShipped ? styles.shippedPill : undefined

  return (
    <Pill pillStyle={STATUS_STYLE[cellData]} size="small" className={className}>
      {customT(i18n.t)(`custom:status:${cellData as Status}`)}
    </Pill>
  )
}
