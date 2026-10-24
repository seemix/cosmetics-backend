type PromoBrand = string | { id: string } | null | undefined

/** Ідентифікатори брендів промокоду. Порожній список означає «усі бренди». */
export function getPromoBrandIds(brands?: PromoBrand[] | null): string[] {
  return (brands ?? [])
    .map((brand) => (typeof brand === 'object' ? brand?.id : brand))
    .filter((id): id is string => Boolean(id))
}

/**
 * Єдине правило для кошика й замовлення: чи діє промокод на товар бренду.
 * Промокод без брендів діє на всі товари, зокрема на товари без бренду.
 */
export function isBrandEligibleForPromo(promoBrandIds: string[], brandId?: string | null): boolean {
  if (promoBrandIds.length === 0) return true
  return Boolean(brandId) && promoBrandIds.includes(brandId as string)
}
