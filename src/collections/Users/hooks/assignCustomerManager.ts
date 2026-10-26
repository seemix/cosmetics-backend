import type { CollectionBeforeChangeHook } from 'payload'

import { isManager } from '@/access/isAdmin'

/**
 * Менеджер, що створює клієнта в адмінці, стає його менеджером (дизайн, В10): `manager` і `roles`
 * примусово виставляються, передані значення ігноруються. Admin, публічна реєстрація й скрипти
 * не змінюються. Зміну `manager` в існуючого клієнта обмежує field access (лише admin).
 */
export const assignCustomerManager: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation !== 'create' || !data || !isManager(req.user)) return data

  data.manager = req.user!.id
  data.roles = ['customer']

  return data
}
