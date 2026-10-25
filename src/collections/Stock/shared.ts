import type { CollectionConfig, NumberField, Validate } from 'payload'
import { number } from 'payload/shared'

import { adminOnly } from '@/access/adminOnly'

/**
 * Журнал і кеш залишків змінює лише код сервісу (Local API з `overrideAccess`).
 * Через REST і адмінку їх можна лише читати, і то лише admin.
 */
export const codeOnlyAccess: CollectionConfig['access'] = {
  read: adminOnly,
  create: () => false,
  update: () => false,
  delete: () => false,
}

type IntegerValidate = Validate<number, unknown, unknown, NumberField>

/** Кількість у штуках: ціле число плюс стандартні required/min/max поля `number`. */
export const validateInteger: IntegerValidate = (value, options) => {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return 'Value must be an integer'
  }

  return number(value, options)
}
