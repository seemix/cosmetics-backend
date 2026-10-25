/**
 * Гроші зберігаємо цілими банями (1 MDL = 100 бані), див. docs/accounting/design.md, розд. 5.
 */

/**
 * Сума в MDL (число або рядок з вводу, кома теж підходить) → цілі бані, до найближчого бана.
 * Половина округлюється від нуля (12.345 → 1235, -12.345 → -1235).
 * Зсув десяткової коми робиться в записі числа, щоб уникнути похибки на кшталт 1.005 * 100.
 */
export const toBani = (mdl: number | string): number => {
  const text = typeof mdl === 'string' ? mdl.trim().replace(',', '.') : String(mdl)
  const value = Number(text)
  if (text === '' || !Number.isFinite(value)) {
    throw new RangeError(`Invalid MDL amount: "${mdl}"`)
  }

  const sign = value < 0 ? -1 : 1
  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e')
  const bani = Math.round(Number(`${mantissa}e${Number(exponent) + 2}`))

  return bani === 0 ? 0 : sign * bani
}

/** Цілі бані → "2 477,20" (пробіл між розрядами, кома, завжди два знаки). Без назви валюти. */
export const formatMDL = (bani: number): string => {
  if (!Number.isInteger(bani)) {
    throw new RangeError(`Bani must be an integer, got ${bani}`)
  }

  const abs = Math.abs(bani)
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const fraction = String(abs % 100).padStart(2, '0')

  return `${bani < 0 ? '-' : ''}${whole},${fraction}`
}

/**
 * Розподіляє `total` бані між рядками пропорційно `weights` методом найбільших залишків:
 * кожен рядок отримує floor своєї частки, решта по одному бану йде рядкам з найбільшою
 * дробовою часткою (нічия: більша вага, далі менший індекс). Сума результату завжди = total.
 * Якщо всі ваги нульові, ділить порівну. Рахує у BigInt, тож без похибок float.
 */
export const allocateLargestRemainder = (total: number, weights: number[]): number[] => {
  if (!Number.isInteger(total) || total < 0) {
    throw new RangeError(`Total must be a non-negative integer, got ${total}`)
  }
  if (weights.length === 0) {
    if (total === 0) return []
    throw new RangeError('Cannot allocate a non-zero total between zero rows')
  }
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    throw new RangeError('Weights must be non-negative integers')
  }

  const sumOfWeights = weights.reduce((sum, weight) => sum + weight, 0)
  const effective = sumOfWeights === 0 ? weights.map(() => 1) : weights
  const denominator = BigInt(sumOfWeights === 0 ? weights.length : sumOfWeights)
  const bigTotal = BigInt(total)

  const parts = effective.map((weight, index) => {
    const product = bigTotal * BigInt(weight)
    return { index, weight, floor: product / denominator, rest: product % denominator }
  })

  const leftover = Number(bigTotal - parts.reduce((sum, part) => sum + part.floor, 0n))
  const winners = new Set(
    [...parts]
      .sort((a, b) => {
        if (a.rest !== b.rest) return a.rest > b.rest ? -1 : 1
        if (a.weight !== b.weight) return b.weight - a.weight
        return a.index - b.index
      })
      .slice(0, leftover)
      .map((part) => part.index),
  )

  return parts.map((part) => Number(part.floor) + (winners.has(part.index) ? 1 : 0))
}
