import type { DefaultServerCellComponentProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import type { ComponentProps } from 'react'

import { customT } from '@/i18n/labels'

type PillStyle = NonNullable<ComponentProps<typeof Pill>['pillStyle']>

const STATUS_STYLE: Record<string, PillStyle> = {
  pending: 'warning',
  backorder: 'error',
  paid: 'success',
  shipped: 'dark',
  cancelled: 'light-gray',
}

type Status = 'pending' | 'backorder' | 'paid' | 'shipped' | 'cancelled'

/** Клітинка статусу замовлення: кольорова мітка. */
export const OrderStatusCell = ({ cellData, i18n }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'string' || !(cellData in STATUS_STYLE)) return <span>—</span>

  return (
    <Pill pillStyle={STATUS_STYLE[cellData]} size="small">
      {customT(i18n.t)(`custom:status:${cellData as Status}`)}
    </Pill>
  )
}
