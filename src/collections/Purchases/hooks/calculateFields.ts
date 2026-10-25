import type { CollectionBeforeChangeHook } from 'payload'

import { type AllocationBase, calculatePurchase } from '../services/calculatePurchase'

type LineData = { quantity?: number; unitPriceBani?: number } & Record<string, unknown>
type ExtraCostData = { amountBani?: number } & Record<string, unknown>

/**
 * Перераховує суми накладної через `calculatePurchase` на кожне збереження чернетки
 * (і в момент проведення). Проведену чи сторновану накладну не чіпає: її суми зафіксовані.
 * Некоректні рядки пропускає без розрахунку, щоб помилку показала валідація полів.
 */
export const calculateFields: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation === 'update' && originalDoc?.status !== 'draft') return data

  // При частковому оновленні беремо відсутні частини з документа.
  const lines: LineData[] = data.lines ?? originalDoc?.lines ?? []
  const extraCosts: ExtraCostData[] = data.extraCosts ?? originalDoc?.extraCosts ?? []
  const allocationBase: AllocationBase = data.allocationBase ?? originalDoc?.allocationBase ?? 'amount'

  let result: ReturnType<typeof calculatePurchase>
  try {
    result = calculatePurchase({
      allocationBase,
      lines: lines.map((line) => ({ quantity: Number(line.quantity), unitPriceBani: Number(line.unitPriceBani) })),
      extraCosts: extraCosts.map((cost) => ({ amountBani: Number(cost.amountBani) })),
    })
  } catch (error) {
    if (error instanceof RangeError) return data
    throw error
  }

  data.allocationBase = allocationBase
  data.extraCosts = extraCosts
  data.lines = lines.map((line, index) => ({ ...line, ...result.lines[index] }))
  data.goodsTotalBani = result.goodsTotalBani
  data.extraTotalBani = result.extraTotalBani
  data.landedTotalBani = result.landedTotalBani

  return data
}
