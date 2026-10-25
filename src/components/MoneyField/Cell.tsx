import type { DefaultServerCellComponentProps } from 'payload'

import { formatMDL } from '@/utilities/money'

/** Клітинка списку: цілі бані як MDL з двома знаками. */
export const MoneyCell = ({ cellData }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'number' || !Number.isInteger(cellData)) return null

  return <span>{formatMDL(cellData)}</span>
}
