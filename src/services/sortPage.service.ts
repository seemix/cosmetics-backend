/**
 * Сортування за ціною йде за тим полем, яке бачить покупець (див. calculateProductPrice):
 * роздріб — `retailPrice`, оптовик — `wholesalePrice`.
 */
export const sortGenerator = (sortParam: string, user?: { wholesale?: boolean | null } | null) => {
  const priceField = user?.wholesale === true ? 'wholesalePrice' : 'retailPrice'

  switch (sortParam) {
    case 'price-asc':
      return priceField
    case 'price-desc':
      return `-${priceField}`
    default:
      return '-updatedAt'
  }
}

export const pageGenerator = (pageParam: string) => {
  return pageParam ? Number(pageParam) : 1
}
