import type { DefaultServerCellComponentProps } from 'payload'

import { formatPercentBp } from '@/utilities/percent'

/** Клітинка списку: базисні пункти як відсоток з двома знаками. */
export const PercentBpCell = ({ cellData }: DefaultServerCellComponentProps) => {
  if (typeof cellData !== 'number' || !Number.isInteger(cellData)) return null

  return <span>{formatPercentBp(cellData)} %</span>
}
