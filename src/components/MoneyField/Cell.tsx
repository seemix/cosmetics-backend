import type { DefaultServerCellComponentProps } from 'payload'

import { formatMDL, formatMDLRounded } from '@/utilities/money'

/** Клітинка списку: цілі бані як MDL з двома знаками. */
export const MoneyCell = ({ cellData, field }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'number' || !Number.isFinite(cellData)) return null

  if (field.admin?.custom?.fractional === true) return <span>{formatMDLRounded(cellData)}</span>
  if (!Number.isInteger(cellData)) return null

  return <span>{formatMDL(cellData)}</span>
}
