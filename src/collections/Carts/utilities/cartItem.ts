/**
 * Хелпери для роботи з позиціями кошика та його власником.
 *
 * Поля `items[].product` і `customer` можуть приходити як рядковий id
 * (depth: 0) або як populated-об'єкт (depth >= 1), тому всюди потрібна
 * однакова нормалізація замість повторюваних тернарників і `@ts-ignore`.
 */

type RelationshipValue = string | number | { id?: string | number | null } | null | undefined

type CartItemLike = {
  product?: RelationshipValue
}

type CartLike = {
  customer?: RelationshipValue
  items?: CartItemLike[] | null
}

/** Витягує id з relationship-значення незалежно від depth. */
function getRelationshipId(value: RelationshipValue): string | undefined {
  if (value === null || value === undefined) return undefined

  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)

  const id = value.id

  return id === null || id === undefined ? undefined : String(id)
}

/** Id товару з позиції кошика або `undefined`, якщо товар не заданий. */
export function getCartItemProductId(item: CartItemLike | null | undefined): string | undefined {
  return getRelationshipId(item?.product)
}

/** Id власника кошика або `undefined`, якщо власника немає. */
export function getCartCustomerId(cart: CartLike | null | undefined): string | undefined {
  return getRelationshipId(cart?.customer)
}

/** Чи належить кошик вказаному користувачу. */
export function isCartOwnedBy(
  cart: CartLike | null | undefined,
  userId: string | number | undefined,
): boolean {
  if (!cart || userId === null || userId === undefined) return false

  const customerId = getCartCustomerId(cart)

  return customerId !== undefined && customerId === String(userId)
}

/** Id товарів кошика в порядку позицій, без порожніх значень. */
export function getCartProductIds(cart: CartLike | null | undefined): string[] {
  return (cart?.items ?? [])
    .map((item) => getCartItemProductId(item))
    .filter((id): id is string => Boolean(id))
}
