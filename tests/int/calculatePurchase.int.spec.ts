import { describe, expect, it } from 'vitest'

import {
  calculatePurchase,
  type AllocationBase,
  type ExtraCostInput,
  type PurchaseLineInput,
} from '@/collections/Purchases/services/calculatePurchase'

// Розд. 5.2 дизайну: A 10 × 120,00, B 5 × 75,50, C 3 × 249,90; логістика 150,00 MDL.
const lines: PurchaseLineInput[] = [
  { quantity: 10, unitPriceBani: 12000 },
  { quantity: 5, unitPriceBani: 7550 },
  { quantity: 3, unitPriceBani: 24990 },
]
const extraCosts: ExtraCostInput[] = [{ amountBani: 15000 }]

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('A8: calculatePurchase', () => {
  it('база amount: таблиця з розд. 5.2', () => {
    const result = calculatePurchase({ allocationBase: 'amount', lines, extraCosts })

    expect(result.lines.map((line) => line.amountBani)).toEqual([120000, 37750, 74970])
    expect(result.lines.map((line) => line.allocatedBani)).toEqual([7735, 2433, 4832])
    expect(result.lines.map((line) => line.landedBani)).toEqual([127735, 40183, 79802])
    expect(result.lines[0].landedUnitCost).toBeCloseTo(12773.5, 6)
    expect(result.lines[1].landedUnitCost).toBeCloseTo(8036.6, 6)
    expect(result.lines[2].landedUnitCost).toBeCloseTo(26600.6667, 4)
    expect(result).toMatchObject({ goodsTotalBani: 232720, extraTotalBani: 15000, landedTotalBani: 247720 })
  })

  it('база quantity: 8 333 / 4 167 / 2 500', () => {
    const result = calculatePurchase({ allocationBase: 'quantity', lines, extraCosts })

    expect(result.lines.map((line) => line.allocatedBani)).toEqual([8333, 4167, 2500])
    expect(result.landedTotalBani).toBe(247720)
  })

  it('кілька статей витрат складаються в одну суму', () => {
    const result = calculatePurchase({
      allocationBase: 'amount',
      lines,
      extraCosts: [{ amountBani: 10000 }, { amountBani: 5000 }],
    })

    expect(result.extraTotalBani).toBe(15000)
    expect(result.lines.map((line) => line.allocatedBani)).toEqual([7735, 2433, 4832])
  })

  it('без витрат: allocated = 0, landed = amount', () => {
    const result = calculatePurchase({ allocationBase: 'amount', lines })

    expect(result.lines.map((line) => line.allocatedBani)).toEqual([0, 0, 0])
    expect(result.lines.map((line) => line.landedBani)).toEqual([120000, 37750, 74970])
    expect(result.extraTotalBani).toBe(0)
  })

  it('один рядок отримує всі витрати', () => {
    const result = calculatePurchase({
      allocationBase: 'amount',
      lines: [{ quantity: 3, unitPriceBani: 1000 }],
      extraCosts: [{ amountBani: 100 }],
    })

    expect(result.lines[0]).toMatchObject({ allocatedBani: 100, landedBani: 3100 })
    expect(result.lines[0].landedUnitCost).toBeCloseTo(1033.3333, 4)
  })

  it('база amount з нульовими цінами: ділить порівну', () => {
    const result = calculatePurchase({
      allocationBase: 'amount',
      lines: [
        { quantity: 1, unitPriceBani: 0 },
        { quantity: 2, unitPriceBani: 0 },
      ],
      extraCosts: [{ amountBani: 101 }],
    })

    expect(result.lines.map((line) => line.allocatedBani)).toEqual([51, 50])
  })

  it('без рядків і без витрат: порожній результат', () => {
    expect(calculatePurchase({ allocationBase: 'amount', lines: [] })).toEqual({
      lines: [],
      goodsTotalBani: 0,
      extraTotalBani: 0,
      landedTotalBani: 0,
    })
  })

  it('витрати без рядків відхиляються', () => {
    expect(() => calculatePurchase({ allocationBase: 'amount', lines: [], extraCosts })).toThrow(RangeError)
  })

  it.each([
    ['дробова кількість', { quantity: 1.5, unitPriceBani: 100 }],
    ['нульова кількість', { quantity: 0, unitPriceBani: 100 }],
    ['дробова ціна', { quantity: 1, unitPriceBani: 10.5 }],
    ['відʼємна ціна', { quantity: 1, unitPriceBani: -1 }],
  ])('некоректний рядок: %s', (_, line) => {
    expect(() => calculatePurchase({ allocationBase: 'amount', lines: [line] })).toThrow(RangeError)
  })

  it.each([0, -5, 1.5])('некоректна сума витрат %s', (amountBani) => {
    expect(() => calculatePurchase({ allocationBase: 'amount', lines, extraCosts: [{ amountBani }] })).toThrow(
      RangeError,
    )
  })

  it('property: Σ alloc = L, Σ landed = товари + L, на випадкових даних', () => {
    // Детермінований генератор (mulberry32): збій відтворюється за seed.
    let seed = 20261025
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))

    for (let run = 0; run < 2000; run++) {
      const base: AllocationBase = random() < 0.5 ? 'amount' : 'quantity'
      const randomLines = Array.from({ length: int(1, 12) }, () => ({
        quantity: int(1, 500),
        unitPriceBani: random() < 0.1 ? 0 : int(1, 5_000_000),
      }))
      const randomExtras = Array.from({ length: int(0, 4) }, () => ({ amountBani: int(1, 50_000_000) }))
      const total = sum(randomExtras.map((cost) => cost.amountBani))

      const result = calculatePurchase({ allocationBase: base, lines: randomLines, extraCosts: randomExtras })
      const context = `run ${run}, base ${base}`

      expect(sum(result.lines.map((line) => line.allocatedBani)), context).toBe(total)
      expect(result.extraTotalBani, context).toBe(total)
      expect(sum(result.lines.map((line) => line.landedBani)), context).toBe(result.landedTotalBani)
      expect(result.landedTotalBani, context).toBe(result.goodsTotalBani + total)
      result.lines.forEach((line) => {
        expect(line.allocatedBani, context).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(line.landedBani), context).toBe(true)
      })
    }
  })
})
