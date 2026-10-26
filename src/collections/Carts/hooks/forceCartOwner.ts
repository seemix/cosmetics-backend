import type { CollectionBeforeChangeHook } from 'payload'

import { isAdmin } from '@/access/isAdmin'

/**
 * Кошик належить тому, хто його створює або змінює: не-admin не може задати чужого `customer`
 * (інакше товари з'являються в кошику жертви). Admin і виклики без користувача (скрипти) не обмежуються.
 */
export const forceCartOwner: CollectionBeforeChangeHook = ({ data, req }) => {
  if (!data || !req.user || isAdmin(req.user)) return data

  data.customer = req.user.id

  return data
}
