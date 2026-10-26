import type { RelationshipField, Validate } from 'payload'

import { checkRole } from '@/access/utilities'
import { customT } from '@/i18n'

const idOf = (value: unknown) => (value && typeof value === 'object' ? (value as { id?: unknown }).id : value)

/** `filterOptions` не захищає API: роль менеджера перевіряється на сервері (як `Users.manager`). */
const validateManager: Validate = async (value, { req, previousValue, required }) => {
  const id = idOf(value)
  if (id === null || id === undefined || id === '') {
    return required ? customT(req.t)('custom:error:salaryManagerRequired') : true
  }
  // Незмінене значення не перевіряємо: колишній менеджер міг втратити роль.
  if (previousValue !== undefined && String(idOf(previousValue)) === String(id)) return true

  const manager = await req.payload
    .findByID({ collection: 'users', id: id as string, depth: 0, overrideAccess: true, req })
    .catch(() => null)

  return manager && checkRole(['manager'], manager) ? true : customT(req.t)('custom:error:customerManagerInvalid')
}

/** Зв'язок на користувача з роллю manager. */
export const managerField = (options: Omit<RelationshipField, 'type' | 'relationTo' | 'hasMany' | 'validate'>): RelationshipField =>
  ({
    ...options,
    type: 'relationship',
    relationTo: 'users',
    hasMany: false,
    filterOptions: { roles: { contains: 'manager' } },
    validate: validateManager,
  }) as RelationshipField
