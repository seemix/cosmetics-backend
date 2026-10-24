import { describe, it, expect } from 'vitest'

import { applyPromoDiscount } from '@/collections/Carts/services/applyPromoDiscount'
import type { NormalizedCart } from '@/collections/Carts/types/normalizedCart'

const makeCart = (): NormalizedCart => ({
  id: 'cart-1',
  subtotal: 250,
  items: [
    { id: 'p1', title: 'A', subtitle: '', slug: 'a', brandId: 'b1', price: 100, quantity: 2 },
    { id: 'p2', title: 'B', subtitle: '', slug: 'b', brandId: 'b2', price: 50, quantity: 1 },
  ],
})

// Тести фіксують поточну поведінку застосування промокоду до кошика.
describe('applyPromoDiscount', () => {
  it('знижує лише товари потрібних брендів', () => {
    const result = applyPromoDiscount({ cart: makeCart(), brandIds: ['b1'], discountPercent: 10 })

    expect(result?.promoDiscount).toBe(20)
    expect(result?.preSubtotal).toBe(250)
    expect(result?.subtotal).toBe(230)
    expect(result?.items[0]).toMatchObject({ price: 90, regularPrice: 100, discountedSubtotal: 180 })
    expect(result?.items[1]).toEqual(makeCart().items[1])
  })

  it('порожній список брендів означає «усі бренди»', () => {
    const result = applyPromoDiscount({ cart: makeCart(), brandIds: [], discountPercent: 10 })

    expect(result?.promoDiscount).toBe(25)
    expect(result?.subtotal).toBe(225)
    expect(result?.items.map((item) => item.price)).toEqual([90, 45])
  })

  it('без brandIds теж застосовується до всіх брендів', () => {
    const result = applyPromoDiscount({ cart: makeCart(), discountPercent: 10 })

    expect(result?.promoDiscount).toBe(25)
  })

  it('пропускає бренди, що мають персональну знижку (excludeBrands)', () => {
    const result = applyPromoDiscount({
      cart: makeCart(),
      discountPercent: 10,
      excludeBrands: [{ brand: 'b1', discountPercent: 15 }],
    })

    expect(result?.promoDiscount).toBe(5)
    expect(result?.subtotal).toBe(245)
    expect(result?.items[0]).toEqual(makeCart().items[0])
    expect(result?.items[1].price).toBe(45)
  })

  it('товар без brandId не підпадає під знижку, якщо бренди задано', () => {
    const cart = makeCart()
    cart.items[0].brandId = undefined

    const result = applyPromoDiscount({ cart, brandIds: ['b1'], discountPercent: 10 })

    expect(result?.promoDiscount).toBe(0)
    expect(result?.subtotal).toBe(250)
  })

  it('товар без brandId отримує знижку, якщо промокод на всі бренди', () => {
    const cart = makeCart()
    cart.items[0].brandId = undefined

    const result = applyPromoDiscount({ cart, discountPercent: 10 })

    expect(result?.promoDiscount).toBe(25)
  })

  it('відсоток понад 100 обмежується до 100, підсумок не йде нижче 0', () => {
    const result = applyPromoDiscount({ cart: makeCart(), discountPercent: 150 })

    expect(result?.promoDiscount).toBe(250)
    expect(result?.subtotal).toBe(0)
    expect(result?.items.map((item) => item.price)).toEqual([0, 0])
  })

  it('округлює суму знижки й ціну за одиницю', () => {
    const cart: NormalizedCart = {
      id: 'c',
      subtotal: 10,
      items: [{ id: 'p', title: 'T', subtitle: '', slug: 't', brandId: 'b1', price: 10, quantity: 1 }],
    }

    const result = applyPromoDiscount({ cart, discountPercent: 15 })

    expect(result?.promoDiscount).toBe(2)
    expect(result?.items[0].price).toBe(9)
    expect(result?.subtotal).toBe(8)
  })

  it('нульовий або від’ємний відсоток повертає той самий кошик', () => {
    const cart = makeCart()

    expect(applyPromoDiscount({ cart, discountPercent: 0 })).toBe(cart)
    expect(applyPromoDiscount({ cart, discountPercent: -5 })).toBe(cart)
  })

  it('порожній або відсутній кошик повертається без змін', () => {
    const empty: NormalizedCart = { id: 'e', subtotal: 0, items: [] }

    expect(applyPromoDiscount({ cart: empty, discountPercent: 10 })).toBe(empty)
    expect(applyPromoDiscount({ cart: null, discountPercent: 10 })).toBeNull()
  })

  it('не мутує вхідний кошик', () => {
    const cart = makeCart()

    applyPromoDiscount({ cart, discountPercent: 10 })

    expect(cart).toEqual(makeCart())
  })
})
