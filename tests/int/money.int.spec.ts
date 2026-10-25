import { describe, expect, it } from 'vitest'

import { validateBani, moneyField } from '@/fields/money'
import { allocateLargestRemainder, formatMDL, toBani } from '@/utilities/money'

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('toBani', () => {
  it('переводить MDL у цілі бані', () => {
    expect(toBani(12.5)).toBe(1250)
    expect(toBani(0)).toBe(0)
    expect(toBani(2477.2)).toBe(247720)
    expect(toBani('120,00')).toBe(12000)
    expect(toBani(' 75.5 ')).toBe(7550)
  })

  it('округлює до бана без похибки float', () => {
    expect(toBani(1.005)).toBe(101)
    expect(toBani(0.285)).toBe(29)
    expect(toBani(12.345)).toBe(1235)
    expect(toBani(-12.345)).toBe(-1235)
    expect(toBani(1e-7)).toBe(0)
    expect(Object.is(toBani(-0.001), 0)).toBe(true)
  })

  it('відхиляє не-числа', () => {
    expect(() => toBani('')).toThrow(RangeError)
    expect(() => toBani('abc')).toThrow(RangeError)
    expect(() => toBani(Number.NaN)).toThrow(RangeError)
  })
})

describe('formatMDL', () => {
  it('два знаки, крапка, кома між розрядами', () => {
    expect(formatMDL(247720)).toBe('2,477.20')
    expect(formatMDL(5)).toBe('0.05')
    expect(formatMDL(0)).toBe('0.00')
    expect(formatMDL(123456789)).toBe('1,234,567.89')
    expect(formatMDL(-1250)).toBe('-12.50')
  })

  it('відхиляє нецілі бані', () => {
    expect(() => formatMDL(1.5)).toThrow(RangeError)
  })
})

describe('allocateLargestRemainder', () => {
  // Розд. 5.2 дизайну: логістика 150,00 MDL = 15 000 бані.
  it('база amount: 7 735 / 2 433 / 4 832', () => {
    expect(allocateLargestRemainder(15000, [120000, 37750, 74970])).toEqual([7735, 2433, 4832])
  })

  it('база quantity: 8 333 / 4 167 / 2 500', () => {
    expect(allocateLargestRemainder(15000, [10, 5, 3])).toEqual([8333, 4167, 2500])
  })

  it('L = 0', () => {
    expect(allocateLargestRemainder(0, [10, 5, 3])).toEqual([0, 0, 0])
    expect(allocateLargestRemainder(0, [])).toEqual([])
  })

  it('один рядок отримує все', () => {
    expect(allocateLargestRemainder(15000, [42])).toEqual([15000])
    expect(allocateLargestRemainder(1, [0])).toEqual([1])
  })

  it('рівні ваги: залишок іде рядкам з меншим індексом', () => {
    expect(allocateLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(allocateLargestRemainder(2, [5, 5, 5])).toEqual([1, 1, 0])
  })

  it('нічия за дробовою часткою: більша вага, далі менший індекс', () => {
    // 1 бан між вагами 1 і 3: частки 0,25 і 0,75, виграє другий
    expect(allocateLargestRemainder(1, [1, 3])).toEqual([0, 1])
    // 3 бані на ваги 2/2/4: усі частки цілі, залишку немає
    expect(allocateLargestRemainder(4, [2, 2, 4])).toEqual([1, 1, 2])
  })

  it('нульові ваги: порівну; нульова вага серед ненульових нічого не отримує', () => {
    expect(allocateLargestRemainder(10, [0, 0, 0])).toEqual([4, 3, 3])
    expect(allocateLargestRemainder(10, [0, 5, 5])).toEqual([0, 5, 5])
  })

  it('великі значення без похибки float', () => {
    const weights = [9_007_199_254, 3_000_000_001, 1]
    const result = allocateLargestRemainder(9_999_999_999, weights)
    expect(sum(result)).toBe(9_999_999_999)
  })

  it('некоректні дані', () => {
    expect(() => allocateLargestRemainder(-1, [1])).toThrow(RangeError)
    expect(() => allocateLargestRemainder(1.5, [1])).toThrow(RangeError)
    expect(() => allocateLargestRemainder(1, [])).toThrow(RangeError)
    expect(() => allocateLargestRemainder(1, [1, -1])).toThrow(RangeError)
  })

  it('сума завжди дорівнює L і розподіл пропорційний (випадкові дані)', () => {
    // Детермінований генератор, щоб тест відтворювався.
    let seed = 20261024
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    for (let run = 0; run < 500; run++) {
      const rows = 1 + Math.floor(random() * 12)
      const weights = Array.from({ length: rows }, () => Math.floor(random() * 500_000))
      const total = Math.floor(random() * 5_000_000)

      const result = allocateLargestRemainder(total, weights)
      const weightSum = sum(weights)

      expect(sum(result)).toBe(total)
      expect(result.every((value) => Number.isInteger(value) && value >= 0)).toBe(true)
      if (weightSum > 0) {
        weights.forEach((weight, index) => {
          const exact = (total * weight) / weightSum
          expect(Math.abs(result[index] - exact)).toBeLessThan(1)
        })
      }
    }
  })
})

describe('moneyField', () => {
  const options = { required: true, min: 0, req: { t: (key: string) => key } } as never

  it('збирає number-поле з компонентами та валідацією цілого', () => {
    const field = moneyField({ name: 'amountBani', label: 'Сума' })

    expect(field.type).toBe('number')
    expect(field.name).toBe('amountBani')
    expect(field.admin?.components?.Field).toBe('@/components/MoneyField/Field#MoneyField')
    expect(field.admin?.components?.Cell).toBe('@/components/MoneyField/Cell#MoneyCell')
  })

  it('зберігає передані admin-опції', () => {
    const field = moneyField({ name: 'x', admin: { readOnly: true, description: 'опис' } })

    expect(field.admin?.readOnly).toBe(true)
    expect(field.admin?.description).toBe('опис')
  })

  it('validate: ціле проходить, дробове ні, required і min враховуються', () => {
    const validate = moneyField({ name: 'x' }).validate!

    expect(validateBani(1250, options)).toBe(true)
    expect(validateBani(12.5, options)).not.toBe(true)
    expect(validateBani(undefined, options)).not.toBe(true)
    expect(validateBani(-1, options)).not.toBe(true)
    expect(validate).toBe(validateBani)
  })
})
