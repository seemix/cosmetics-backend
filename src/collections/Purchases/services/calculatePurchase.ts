import { allocateLargestRemainder } from '@/utilities/money'

/**
 * Розрахунок приходної накладної: розподіл додаткових витрат (логістика, мито, пакування)
 * на рядки методом найбільших залишків, див. docs/accounting/design.md, розд. 5.2.
 * Чиста функція: хуки колекції викликають її на кожне збереження чернетки.
 */

export type AllocationBase = 'amount' | 'quantity'

export type PurchaseLineInput = {
  quantity: number
  unitPriceBani: number
}

export type ExtraCostInput = {
  amountBani: number
}

export type PurchaseLineResult = {
  amountBani: number
  allocatedBani: number
  landedBani: number
  /** Посадочна ціна за штуку, дробове значення лише для показу. */
  landedUnitCost: number
}

export type PurchaseCalculation = {
  lines: PurchaseLineResult[]
  goodsTotalBani: number
  extraTotalBani: number
  landedTotalBani: number
}

type CalculatePurchaseArgs = {
  allocationBase: AllocationBase
  lines: PurchaseLineInput[]
  extraCosts?: ExtraCostInput[]
}

const assertInteger = (value: number, label: string, min: number) => {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${label} must be an integer >= ${min}, got ${value}`)
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export const calculatePurchase = ({
  allocationBase,
  lines,
  extraCosts = [],
}: CalculatePurchaseArgs): PurchaseCalculation => {
  lines.forEach((line, index) => {
    assertInteger(line.quantity, `Line ${index + 1} quantity`, 1)
    assertInteger(line.unitPriceBani, `Line ${index + 1} unit price`, 0)
  })
  extraCosts.forEach((cost, index) => assertInteger(cost.amountBani, `Extra cost ${index + 1} amount`, 1))

  const amounts = lines.map((line) => line.quantity * line.unitPriceBani)
  const extraTotalBani = sum(extraCosts.map((cost) => cost.amountBani))
  const weights = allocationBase === 'quantity' ? lines.map((line) => line.quantity) : amounts

  // Витрати без рядків розподілити нікуди: allocateLargestRemainder кине помилку.
  const allocated = allocateLargestRemainder(extraTotalBani, weights)

  const resultLines = lines.map((line, index) => {
    const landedBani = amounts[index] + allocated[index]

    return {
      amountBani: amounts[index],
      allocatedBani: allocated[index],
      landedBani,
      landedUnitCost: landedBani / line.quantity,
    }
  })

  const goodsTotalBani = sum(amounts)

  return {
    lines: resultLines,
    goodsTotalBani,
    extraTotalBani,
    landedTotalBani: goodsTotalBani + extraTotalBani,
  }
}
