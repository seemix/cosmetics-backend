import { APIError, type CollectionBeforeChangeHook } from 'payload'

import { customT } from '@/i18n'
import { cents, isOrderEditable, isOrderPosted, relationID, sameItems } from '@/services/orders/orderState'

/**
 * Сума продажу змінюється лише в замовленні, що чекає проведення й не оплачене (В20).
 * Проведене, оплачене, скасоване чи історичне замовлення не змінює позиції, суму, знижку,
 * клієнта й менеджера (дизайн, розд. 9.2, F6, S2.1). Відвантажене не повертається з `shipped`:
 * зняти проведення можна лише скасуванням.
 * На update перевіряються лише поля, що прийшли в `data`: адмінка надсилає весь документ,
 * тому однакові значення пропускаються, а змінені відхиляються.
 */
export const guardPostedOrder: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || !originalDoc) return data

  const statusChanged = 'status' in data && data.status && data.status !== originalDoc.status

  // Скасування кінцеве (розд. 9.1): повернений залишок назад не списується.
  if (originalDoc.status === 'cancelled' && statusChanged) {
    throw new APIError(customT(req.t)('custom:error:cancelledOrderFinal'), 409, undefined, true)
  }

  // Замовлення, проведені до В20 при створенні, могли лишитися в `pending`/`paid`: їм статус змінювати можна.
  if (isOrderPosted(originalDoc) && originalDoc.status === 'shipped' && statusChanged && data.status !== 'cancelled') {
    throw new APIError(customT(req.t)('custom:error:postedOrderStatus'), 409, undefined, true)
  }

  if (isOrderEditable(originalDoc)) return data

  const changed =
    ('items' in data && data.items !== undefined && !sameItems(data.items, originalDoc.items)) ||
    ('total' in data && data.total !== undefined && cents(data.total) !== cents(originalDoc.total)) ||
    ('discount' in data && cents(data.discount) !== cents(originalDoc.discount)) ||
    ('customer' in data && relationID(data.customer) !== relationID(originalDoc.customer)) ||
    ('manager' in data && relationID(data.manager) !== relationID(originalDoc.manager))

  if (changed) {
    const key = isOrderPosted(originalDoc) ? 'custom:error:postedOrderLocked' : 'custom:error:orderLocked'
    throw new APIError(customT(req.t)(key), 400, undefined, true)
  }

  return data
}
