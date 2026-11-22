import type { DefaultServerCellComponentProps } from 'payload'

import { formatMDL, toBani } from '@/utilities/money'

/** Клітинка суми замовлення: MDL з двома знаками й розрядами. */
export const OrderTotalCell = ({ cellData }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'number' || !Number.isFinite(cellData)) return <span>—</span>

  return <span className="orders-list-total">{formatMDL(toBani(cellData))}</span>
}
