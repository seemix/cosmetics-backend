type CalculatePriceParams = {
  product: any
  user?: any
}

export type PriceResult = {
  price: number
  discountPrice?: number
  isWholesale: boolean
}

/**
 * Універсальний розрахунок ціни з урахуванням опту та брендових знижок
 */
export function calculateProductPrice({ product, user }: CalculatePriceParams): PriceResult {
  const isWholesale = user?.wholesale === true

  // 1. Для звичайних покупців — роздрібна ціна
  if (!isWholesale) {
    const retailPrice = typeof product?.retailPrice === 'number' ? product.retailPrice : 0
    return {
      price: retailPrice,
      isWholesale: false,
    }
  }

  // 2. Для оптовиків — розрахунок від wholesalePrice
  const baseWholesalePrice = typeof product?.wholesalePrice === 'number' ? product.wholesalePrice : 0

  const brandId = typeof product?.brand === 'object' ? product.brand?.id : product?.brand

  const userBrandDiscount = user?.brandDiscounts?.find((d: any) => {
    const discountBrandId = typeof d.brand === 'object' ? d.brand.id : d.brand
    return String(discountBrandId) === String(brandId)
  })

  const discountPercent = userBrandDiscount?.discountPercent || 0

  let discountPrice: number | undefined

  if (discountPercent > 0 && baseWholesalePrice > 0) {
    discountPrice = Math.round(baseWholesalePrice * (1 - discountPercent / 100))
  }

  return {
    price: baseWholesalePrice,
    discountPrice,
    isWholesale: true,
  }
}