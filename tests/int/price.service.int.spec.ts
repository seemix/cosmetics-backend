import { describe, it, expect } from 'vitest'

import { calculateProductPrice } from '@/services/price.service'

// Тести фіксують поточну поведінку ціноутворення (роздріб, опт, знижка по бренду).
describe('calculateProductPrice', () => {
  const brandId = 'brand-1'
  const product = { retailPrice: 1200, wholesalePrice: 1000, brand: brandId }

  describe('роздрібний покупець', () => {
    it('гість без користувача бачить роздрібну ціну без знижки', () => {
      expect(calculateProductPrice({ product })).toEqual({ price: 1200, isWholesale: false })
    })

    it('користувач без прапорця wholesale бачить роздрібну ціну', () => {
      const result = calculateProductPrice({ product, user: { wholesale: false } })

      expect(result).toEqual({ price: 1200, isWholesale: false })
    })

    it('прапорець wholesale має бути саме true', () => {
      const result = calculateProductPrice({ product, user: { wholesale: 'true' } })

      expect(result.isWholesale).toBe(false)
      expect(result.price).toBe(1200)
    })

    it('брендові знижки ігноруються для роздрібного покупця', () => {
      const user = { wholesale: false, brandDiscounts: [{ brand: brandId, discountPercent: 20 }] }

      expect(calculateProductPrice({ product, user })).toEqual({ price: 1200, isWholesale: false })
    })

    it('відсутня або нечислова retailPrice дає 0', () => {
      expect(calculateProductPrice({ product: {} }).price).toBe(0)
      expect(calculateProductPrice({ product: { retailPrice: '100' } }).price).toBe(0)
      expect(calculateProductPrice({ product: undefined }).price).toBe(0)
    })

    it('адмін без прапорця wholesale бачить роздрібну ціну', () => {
      const result = calculateProductPrice({ product, user: { roles: ['admin'] } })

      expect(result).toEqual({ price: 1200, isWholesale: false })
    })
  })

  describe('оптовий покупець', () => {
    it('без знижок бачить wholesalePrice і не має discountPrice', () => {
      const result = calculateProductPrice({ product, user: { wholesale: true } })

      expect(result).toEqual({ price: 1000, discountPrice: undefined, isWholesale: true })
    })

    it('застосовує знижку свого бренду', () => {
      const user = { wholesale: true, brandDiscounts: [{ brand: brandId, discountPercent: 10 }] }

      expect(calculateProductPrice({ product, user })).toEqual({
        price: 1000,
        discountPrice: 900,
        isWholesale: true,
      })
    })

    it('знижка іншого бренду не застосовується', () => {
      const user = { wholesale: true, brandDiscounts: [{ brand: 'brand-2', discountPercent: 10 }] }

      expect(calculateProductPrice({ product, user }).discountPrice).toBeUndefined()
    })

    it('порівнює бренд товару й знижки і як id, і як populated-об’єкт', () => {
      const populatedProduct = { ...product, brand: { id: brandId } }
      const populatedUser = {
        wholesale: true,
        brandDiscounts: [{ brand: { id: brandId }, discountPercent: 10 }],
      }

      expect(calculateProductPrice({ product: populatedProduct, user: populatedUser }).discountPrice).toBe(900)
      expect(
        calculateProductPrice({
          product: populatedProduct,
          user: { wholesale: true, brandDiscounts: [{ brand: brandId, discountPercent: 10 }] },
        }).discountPrice,
      ).toBe(900)
    })

    it('порівнює id через рядки (число проти рядка)', () => {
      const user = { wholesale: true, brandDiscounts: [{ brand: 7, discountPercent: 10 }] }

      expect(calculateProductPrice({ product: { ...product, brand: '7' }, user }).discountPrice).toBe(900)
    })

    it('округлює ціну зі знижкою до цілого', () => {
      const user = { wholesale: true, brandDiscounts: [{ brand: brandId, discountPercent: 15 }] }
      const result = calculateProductPrice({ product: { ...product, wholesalePrice: 333 }, user })

      expect(result.discountPrice).toBe(283)
    })

    it('нульова або відсутня знижка не дає discountPrice', () => {
      const zero = { wholesale: true, brandDiscounts: [{ brand: brandId, discountPercent: 0 }] }
      const missing = { wholesale: true, brandDiscounts: [{ brand: brandId }] }

      expect(calculateProductPrice({ product, user: zero }).discountPrice).toBeUndefined()
      expect(calculateProductPrice({ product, user: missing }).discountPrice).toBeUndefined()
    })

    it('без wholesalePrice ціна 0 і знижка не рахується', () => {
      const user = { wholesale: true, brandDiscounts: [{ brand: brandId, discountPercent: 10 }] }
      const result = calculateProductPrice({ product: { retailPrice: 1200, brand: brandId }, user })

      expect(result).toEqual({ price: 0, discountPrice: undefined, isWholesale: true })
    })

    it('використовує першу знижку, якщо бренд повторюється', () => {
      const user = {
        wholesale: true,
        brandDiscounts: [
          { brand: brandId, discountPercent: 10 },
          { brand: brandId, discountPercent: 30 },
        ],
      }

      expect(calculateProductPrice({ product, user }).discountPrice).toBe(900)
    })
  })
})
