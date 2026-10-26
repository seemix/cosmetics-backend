import { APIError, type CollectionBeforeValidateHook } from 'payload'

import { isAdmin } from '@/access/isAdmin'
import { customT } from '@/i18n'

/** Службові поля автентифікації Payload: `hidden` ховає їх лише у відповідях, записати їх із тіла можна. */
const AUTH_SERVICE_FIELDS = ['resetPasswordToken', 'resetPasswordExpiration', 'loginAttempts', 'lockUntil']

/**
 * Клієнт (і гість при реєстрації) не задає службові поля автентифікації, а авторизований не-admin не змінює email:
 * Payload шле лист підтвердження лише при створенні, тож нова адреса лишилась би «підтвердженою».
 * Виклики без користувача (скрипти) email не обмежуються.
 */
export const guardAccountFields: CollectionBeforeValidateHook = ({ data, operation, originalDoc, req }) => {
  if (!data || isAdmin(req.user)) return data

  // Власні операції Payload (forgot-password, login) оновлюють ці поля без користувача, тому на update чіпаємо лише запити користувача.
  if (operation === 'create' || req.user) {
    for (const key of AUTH_SERVICE_FIELDS) delete (data as Record<string, unknown>)[key]
  }

  if (operation === 'update' && req.user && typeof data.email === 'string' && originalDoc) {
    if (data.email.toLowerCase() !== String(originalDoc.email).toLowerCase()) {
      throw new APIError(customT(req.t)('custom:error:emailChangeForbidden'), 403, undefined, true)
    }
  }

  return data
}
