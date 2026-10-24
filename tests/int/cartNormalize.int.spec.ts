import { describe, it, expect } from 'vitest'

import { normalizeCart } from '@/collections/Carts/services/normalizedCart'
import {
  getCartCustomerId,
  getCartItemProductId,
  getCartProductIds,
  isCartOwnedBy,
} from '@/collections/Carts/utilities/cartItem'

describe('normalizeCart', () => {
  const product = {
    id: 'p1',
    title: 'Крем',
    slug: 'krem',
    brand: { id: 'b1' },
    subtitle: { ru: 'Описание', ro: 'Descriere', en: 'Description' },
    gallery: [{ image: { sizes: { thumbnail: { url: '/thumb.jpg' } }, thumbnailURL: '/old.jpg' } }],
  }
  const productsMap = new Map<string, any>([['p1', product]])

  it('мапить позиції з productsMap і зберігає підсумок', () => {
    const cart = { id: 'c1', subtotal: 300, items: [{ product: 'p1', price: 150, quantity: 2 }] }

    expect(normalizeCart(cart, productsMap, 'ru')).toEqual({
      id: 'c1',
      subtotal: 300,
      items: [
        {
          id: 'p1',
          title: 'Крем',
          subtitle: 'Описание',
          slug: 'krem',
          brandId: 'b1',
          price: 150,
          quantity: 2,
          thumbnail: '/thumb.jpg',
        },
      ],
    })
  })

  it('приймає product як populated-об’єкт', () => {
    const cart = { id: 'c1', subtotal: 150, items: [{ product: { id: 'p1' }, price: 150, quantity: 1 }] }

    expect(normalizeCart(cart, productsMap).items[0].id).toBe('p1')
  })

  it('вибирає subtitle за локаллю, потім en, потім порожній рядок', () => {
    const cart = { id: 'c', subtotal: 0, items: [{ product: 'p1', price: 1, quantity: 1 }] }
    const only = (subtitle: unknown) =>
      new Map<string, any>([['p1', { ...product, subtitle }]])

    expect(normalizeCart(cart, productsMap, 'ro').items[0].subtitle).toBe('Descriere')
    expect(normalizeCart(cart, only({ en: 'Description' }), 'ro').items[0].subtitle).toBe('Description')
    expect(normalizeCart(cart, only({}), 'ro').items[0].subtitle).toBe('')
    expect(normalizeCart(cart, only('Plain'), 'ro').items[0].subtitle).toBe('Plain')
  })

  it('мініатюра: sizes.thumbnail, потім thumbnailURL, потім null', () => {
    const cart = { id: 'c', subtotal: 0, items: [{ product: 'p1', price: 1, quantity: 1 }] }
    const withGallery = (gallery: unknown) =>
      new Map<string, any>([['p1', { ...product, gallery }]])

    expect(normalizeCart(cart, withGallery([{ image: { thumbnailURL: '/old.jpg' } }])).items[0].thumbnail).toBe('/old.jpg')
    expect(normalizeCart(cart, withGallery([])).items[0].thumbnail).toBeNull()
  })

  it('товар відсутній у productsMap не ламає нормалізацію', () => {
    const cart = { id: 'c', subtotal: 10, items: [{ product: 'missing', price: 10, quantity: 1 }] }

    expect(normalizeCart(cart, productsMap).items[0]).toEqual({
      id: 'missing',
      title: '',
      subtitle: '',
      slug: '',
      brandId: undefined,
      price: 10,
      quantity: 1,
      thumbnail: null,
    })
  })

  it('товар без бренду (T28) дає brandId undefined без помилки', () => {
    const noBrand = new Map<string, any>([['p1', { ...product, brand: undefined }]])
    const cart = { id: 'c', subtotal: 0, items: [{ product: 'p1', price: 1, quantity: 1 }] }

    expect(normalizeCart(cart, noBrand).items[0].brandId).toBeUndefined()
  })

  it('порожній кошик дає порожній список позицій', () => {
    expect(normalizeCart({ id: 'c', subtotal: 0, items: [] }, productsMap).items).toEqual([])
  })
})

describe('cartItem utilities', () => {
  it('getCartItemProductId: рядок, число, об’єкт, порожнє', () => {
    expect(getCartItemProductId({ product: 'p1' })).toBe('p1')
    expect(getCartItemProductId({ product: 5 })).toBe('5')
    expect(getCartItemProductId({ product: { id: 'p2' } })).toBe('p2')
    expect(getCartItemProductId({ product: { id: null } })).toBeUndefined()
    expect(getCartItemProductId({ product: null })).toBeUndefined()
    expect(getCartItemProductId(undefined)).toBeUndefined()
  })

  it('getCartProductIds зберігає порядок і відкидає порожні', () => {
    const cart = { items: [{ product: 'a' }, { product: null }, { product: { id: 'b' } }, {}] }

    expect(getCartProductIds(cart)).toEqual(['a', 'b'])
    expect(getCartProductIds({ items: null })).toEqual([])
    expect(getCartProductIds(null)).toEqual([])
  })

  it('getCartCustomerId приймає id і populated-об’єкт', () => {
    expect(getCartCustomerId({ customer: 'u1' })).toBe('u1')
    expect(getCartCustomerId({ customer: { id: 'u2' } })).toBe('u2')
    expect(getCartCustomerId({})).toBeUndefined()
  })

  it('isCartOwnedBy порівнює власника як рядки і не пускає порожніх', () => {
    expect(isCartOwnedBy({ customer: 'u1' }, 'u1')).toBe(true)
    expect(isCartOwnedBy({ customer: { id: 7 } }, 7)).toBe(true)
    expect(isCartOwnedBy({ customer: { id: 7 } }, '7')).toBe(true)
    expect(isCartOwnedBy({ customer: 'u1' }, 'u2')).toBe(false)
    expect(isCartOwnedBy({ customer: 'u1' }, undefined)).toBe(false)
    expect(isCartOwnedBy({}, 'u1')).toBe(false)
    expect(isCartOwnedBy(null, 'u1')).toBe(false)
  })
})
