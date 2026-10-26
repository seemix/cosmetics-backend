import type { Payload, PayloadRequest } from 'payload'

import { isManager } from '@/access/isAdmin'

type ID = string | number

const relationID = (value: unknown): ID | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return value as ID
}

/**
 * Менеджер, чий це продаж (дизайн, розд. 7.1), для знімка `Orders.manager` на create:
 * 1) у клієнта є менеджер ⇒ він (навіть коли замовлення оформив інший менеджер);
 * 2) інакше творець із роллю manager, якщо `assignOrderToCreatorIfNoManager`;
 * 3) інакше null (гість, admin без менеджера клієнта, прапорець вимкнено).
 * Клієнта читаємо з `overrideAccess`: публічний `createOrder` не має прав на читання користувачів.
 */
export const resolveOrderManager = async ({
  customerId,
  creator,
  settings,
  req,
}: {
  customerId: unknown
  creator: { id: ID; roles?: unknown } | null | undefined
  settings: { assignOrderToCreatorIfNoManager?: boolean | null }
  req: PayloadRequest & { payload: Payload }
}): Promise<ID | null> => {
  const id = relationID(customerId)

  if (id !== undefined) {
    const customer = await req.payload.findByID({
      collection: 'users',
      id: id as string,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const customerManager = relationID(customer?.manager)
    if (customerManager !== undefined) return customerManager
  }

  if (creator && isManager(creator) && settings.assignOrderToCreatorIfNoManager) return creator.id

  return null
}
