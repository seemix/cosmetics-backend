import type { DefaultServerCellComponentProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import type { ComponentProps } from 'react'

import { customT } from '@/i18n/labels'
import { EditOrderLink } from './EditOrderLink'
import { PickOrderButton, type PickItem } from './PickOrderButton'
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
export const OrderStatusCell = ({ cellData, i18n, rowData }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'string' || !(cellData in STATUS_STYLE)) return <span>—</span>

  const isShipped = cellData === 'shipped'
  const className = isShipped ? styles.shippedPill : undefined
  const orderId = rowData?.id ? String(rowData.id) : null
  const orderNumber = rowData?.orderNumber != null ? String(rowData.orderNumber) : null
  const rawItems: { product?: unknown; quantity?: unknown }[] = Array.isArray(rowData?.items)
    ? rowData.items
    : []
  const pickItems: PickItem[] = rawItems.map((item) => {
    const product =
      item?.product && typeof item.product === 'object'
        ? (item.product as { id?: unknown }).id
        : item?.product
    return {
      product: product != null ? String(product) || null : null,
      quantity: typeof item?.quantity === 'number' ? item.quantity : null,
    }
  })

  return (
    <span className={styles.statusCell}>
      <Pill pillStyle={STATUS_STYLE[cellData]} size="small" className={className}>
        {customT(i18n.t)(`custom:status:${cellData as Status}`)}
      </Pill>
      {orderId && (
        <span className={styles.actions}>
          <PickOrderButton
            id={orderId}
            orderNumber={orderNumber}
            status={cellData}
            items={pickItems}
            className={styles.pickButton}
          />
          <EditOrderLink id={orderId} className={styles.editButton} />
        </span>
      )}
    </span>
  )
}
