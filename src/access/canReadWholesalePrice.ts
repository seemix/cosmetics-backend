import type { FieldAccess } from 'payload'

import type { User } from '@/payload-types'
import { checkRole } from '@/access/utilities'

/**
 * Єдине правило доступу до `wholesalePrice`.
 *
 * Рішення D3: адмін бачить оптову ціну незалежно від прапорця `wholesale`.
 * Оптовий клієнт бачить її за прапорцем, роздрібний — ні, гість — ні.
 *
 * Предикат для сервісів та ендпоінтів, які читають через Local API
 * (там `overrideAccess` за замовчуванням `true`, тому field access не діє).
 */
export function canUserReadWholesalePrice(user?: User | null): boolean {
  if (!user) return false

  if (user.wholesale === true) return true

  return checkRole(['admin'], user)
}

/** Те саме правило у вигляді field access для колекції Products. */
export const canReadWholesalePrice: FieldAccess = ({ req: { user } }) =>
  canUserReadWholesalePrice(user)
