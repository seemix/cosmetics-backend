import type { Where } from 'payload'

import type { User } from '@/payload-types'
import { checkRole } from '@/access/utilities'

/** Admin і manager бачать чернетки товарів (як у `products.access.read`); решта лише не чернетки. */
export const canSeeDraftProducts = (user?: User | null): boolean => checkRole(['admin', 'manager'], user)

/**
 * Публічні ендпоінти читають товари через Local API з обходом access, тож чернетки треба відсікти вручну.
 * `not_equals: 'draft'` (а не `equals: 'published'`), щоб не сховати старі товари без `_status`.
 */
export const withPublishedProducts = (where: Where, user?: User | null): Where =>
  canSeeDraftProducts(user) ? where : { and: [where, { _status: { not_equals: 'draft' } }] }
