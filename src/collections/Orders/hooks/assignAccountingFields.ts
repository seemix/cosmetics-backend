import type { CollectionBeforeChangeHook } from 'payload'

import { isOrderEditable } from '@/services/orders/orderState'
import { resolveOrderManager } from '@/services/orders/resolveOrderManager'

/** Ключ `req.context`, яким публічний `createOrder` позначає замовлення сайту. */
export const ORDER_SOURCE_CONTEXT_KEY = 'orderSource'

const relationID = (value: unknown): string | number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return value as string | number
}

/**
 * Облікові поля замовлення (дизайн, розд. 2.5, 4.3).
 * Create: `source` за контекстом, склад (для сайту завжди з налаштувань, значення з тіла ігнорується),
 * автор, знімок `manager` і `accounting.revenueBani`. Update: `source`, `createdBy` не змінюються;
 * `warehouse`, `manager` і `revenueBani` змінюються лише в замовленні, що чекає проведення й не оплачене (В20, В22).
 * Має йти після `populatePricesAndTotal`, бо виручка береться з готового `total`.
 */
export const assignAccountingFields: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data

  if (operation === 'update') {
    if (originalDoc) {
      data.source = originalDoc.source
      // Склад змінюється лише до відвантаження й оплати (В22); порожнє значення його не стирає.
      const warehouse = relationID(data.warehouse)
      data.warehouse = isOrderEditable(originalDoc) && warehouse !== undefined ? warehouse : relationID(originalDoc.warehouse)
      data.createdBy = relationID(originalDoc.createdBy)
      data.manager = relationID(originalDoc.manager)

      // Непроведене замовлення можна змінити (В20): виручка йде за новою сумою, знімок менеджера за новим клієнтом.
      if (isOrderEditable(originalDoc)) {
        const total = data.total ?? originalDoc.total
        data.accounting = {
          ...originalDoc.accounting,
          ...data.accounting,
          revenueBani: Math.round((Number(total) || 0) * 100),
        }

        if ('customer' in data && String(relationID(data.customer) ?? '') !== String(relationID(originalDoc.customer) ?? '')) {
          const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
          const creatorId = relationID(originalDoc.createdBy)
          const creator = creatorId
            ? await req.payload.findByID({ collection: 'users', id: creatorId, depth: 0, overrideAccess: true, disableErrors: true, req })
            : null
          data.manager = (await resolveOrderManager({ customerId: data.customer, creator, settings, req })) ?? null
        }
      }
    }
    return data
  }

  const isWeb = req.context?.[ORDER_SOURCE_CONTEXT_KEY] === 'web'
  data.source = isWeb ? 'web' : 'admin'

  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  data.warehouse = isWeb
    ? relationID(settings.defaultWebWarehouse)
    : (relationID(data.warehouse) ?? relationID(settings.defaultAdminWarehouse))

  data.createdBy = isWeb ? undefined : relationID(req.user?.id)
  // Знімок менеджера (розд. 7.1): далі не змінюється; `createOrder` не передає творця.
  data.manager =
    (await resolveOrderManager({
      customerId: data.customer,
      creator: isWeb ? null : req.user,
      settings,
      req,
    })) ?? undefined

  data.accounting = {
    ...data.accounting,
    revenueBani: Math.round((Number(data.total) || 0) * 100),
  }
  data.paidBani = 0
  data.paymentState = 'unpaid'

  return data
}
