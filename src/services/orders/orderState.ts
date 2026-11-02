/**
 * Стан замовлення в обліку (docs/decisions.md, В20). Замовлення проводиться (списує залишок,
 * отримує `accounting.stockPostedAt`) при переході в `shipped`. До того воно чекає проведення,
 * якщо створене з увімкненим обліком складу (`accounting.stockTracked`). Замовлення без обох ознак
 * історичне: створене до вмикання обліку, не списує склад і оплату приймає лише за customerDebt.
 */
type OrderStateLike = {
  status?: string | null
  paidBani?: number | null
  accounting?: { stockTracked?: boolean | null; stockPostedAt?: Date | string | null } | null
} | null | undefined

/** Залишок списано: замовлення проведене. */
export const isOrderPosted = (order: OrderStateLike): boolean => Boolean(order?.accounting?.stockPostedAt)

/** Облікове замовлення, ще не проведене (до відвантаження). */
export const isOrderAwaitingPosting = (order: OrderStateLike): boolean =>
  !isOrderPosted(order) && order?.accounting?.stockTracked === true

/** Історичне: створене до вмикання обліку складу, ніколи не проводиться. */
export const isOrderHistorical = (order: OrderStateLike): boolean =>
  !isOrderPosted(order) && order?.accounting?.stockTracked !== true

/**
 * Позиції, суму, знижку й клієнта можна змінити: замовлення чекає проведення, не скасоване
 * й не оплачене (інакше сума могла б стати меншою за сплачене).
 */
export const isOrderEditable = (order: OrderStateLike): boolean =>
  isOrderAwaitingPosting(order) && order?.status !== 'cancelled' && (Number(order?.paidBani) || 0) <= 0

type ItemLike = { product?: unknown; quantity?: unknown; price?: unknown }

export const relationID = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return String(value)
}

/** Сума в банах для порівняння (поля замовлення зберігають леї). */
export const cents = (value: unknown): number => Math.round((Number(value) || 0) * 100)

/** Ті самі позиції: товар, кількість і ціна в тому самому порядку. */
export const sameItems = (next: unknown, prev: unknown): boolean => {
  const a = Array.isArray(next) ? (next as ItemLike[]) : []
  const b = Array.isArray(prev) ? (prev as ItemLike[]) : []
  if (a.length !== b.length) return false

  return a.every(
    (item, i) =>
      relationID(item?.product) === relationID(b[i]?.product) &&
      Number(item?.quantity) === Number(b[i]?.quantity) &&
      cents(item?.price) === cents(b[i]?.price),
  )
}
