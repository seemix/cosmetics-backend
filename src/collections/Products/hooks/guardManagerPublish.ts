import { APIError, type CollectionBeforeOperationHook } from 'payload'

import { isManager } from '@/access/isAdmin'
import { customT } from '@/i18n'

/**
 * Manager редагує товар лише чернеткою; публікує admin (розд. 11, В8).
 * Перевірка в `beforeOperation`, бо лише тут видно аргумент `draft`. Умова та сама, що в Payload
 * для збереження чернетки: `draft` і `_status` не `published`; інакше це публікація.
 */
export const guardManagerPublish: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  if (operation !== 'update' || !isManager(req.user)) return args

  if (!args?.draft || args.data?._status === 'published') {
    throw new APIError(customT(req.t)('custom:error:managerCannotPublish'), 403, undefined, true)
  }

  return args
}
