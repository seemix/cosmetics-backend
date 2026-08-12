import type { NormalizedCart, ApplyDiscountParams } from '@/collections/Carts/types/normalizedCart'


// Додаємо excludeBrands до типів параметрів (якщо ви не редагуєте NormalizeCart типи напряму)

export const applyPromoDiscount = ({
                                     cart,
                                     brandIds = [],
                                     discountPercent,
                                     excludeBrands = [],
                                   }: ApplyDiscountParams): NormalizedCart | null => {
  if (!cart?.items?.length || discountPercent <= 0) {
    return cart
  }

  const validDiscountPercent = Math.min(Math.max(discountPercent, 0), 100)
  const isApplyToAll = brandIds.length === 0

  // Створюємо Set для швидкої перевірки O(1) за заблокованими ID брендів
  const excludedBrandIds = new Set(excludeBrands?.map((item) => item.brand))

  let totalDiscount = 0

  const updatedItems = cart.items.map((item) => {
    // 1. Перевіряємо, чи має бренд товару персональну знижку
    const isExcluded = item.brandId ? excludedBrandIds.has(item.brandId) : false

    // 2. Товар підпадає під промокод, ТІЛЬКИ якщо він підходить під умови ТА НЕ є в списку виключень
    const isEligible = !isExcluded && (isApplyToAll || (item.brandId && brandIds.includes(item.brandId)))

    if (isEligible) {
      const originalItemSubtotal = item.price * item.quantity
      const itemDiscount = (originalItemSubtotal * validDiscountPercent) / 100

      totalDiscount += itemDiscount

      return {
        ...item,
        regularPrice: item.price,
        price: Math.round(item.price * (1 - validDiscountPercent / 100)),
        discountedSubtotal: originalItemSubtotal - itemDiscount,
      }
    }

    return item
  })

  const preSubtotal = cart.subtotal

  // Округлення всієї суми знижки до цілого числа
  const promoDiscount = Math.round(totalDiscount)

  // Підсумкова сума кошика
  const finalSubtotal = Math.max(0, preSubtotal - promoDiscount)

  return {
    ...cart,
    items: updatedItems,
    preSubtotal,
    promoDiscount,
    subtotal: Math.round(finalSubtotal),
  }
}