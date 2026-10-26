/**
 * Відсотки зберігаємо цілими базисними пунктами: 1 % = 100 б.п., 12,35 % = 1235 (розд. 2.5, M4).
 */

export const MAX_PERCENT_BP = 10000

/**
 * Відсоток з вводу (число або рядок, кома теж підходить) → цілі базисні пункти, до найближчого.
 * Зсув коми робиться в записі числа, як у `toBani`, щоб уникнути похибки float.
 */
export const toBasisPoints = (percent: number | string): number => {
  const text = typeof percent === 'string' ? percent.trim().replace(',', '.') : String(percent)
  const value = Number(text)
  if (text === '' || !Number.isFinite(value)) {
    throw new RangeError(`Invalid percent: "${percent}"`)
  }

  const sign = value < 0 ? -1 : 1
  const [mantissa, exponent = '0'] = String(Math.abs(value)).split('e')
  const bp = Math.round(Number(`${mantissa}e${Number(exponent) + 2}`))

  return bp === 0 ? 0 : sign * bp
}

/** Цілі базисні пункти → "12.35" (крапка, завжди два знаки). Без знака відсотка. */
export const formatPercentBp = (bp: number): string => {
  if (!Number.isInteger(bp)) {
    throw new RangeError(`Basis points must be an integer, got ${bp}`)
  }

  const abs = Math.abs(bp)

  return `${bp < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
