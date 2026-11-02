import { APIError, type CollectionBeforeChangeHook } from 'payload'

import { isManager } from '@/access/isAdmin'
import { customT } from '@/i18n'
import { isOrderEditable } from '@/services/orders/orderState'

/** Службові поля, які адмінка надсилає разом із документом і які не є зміною замовлення. */
const IGNORED_KEYS = new Set(['id', 'createdAt', 'updatedAt'])

/**
 * Значення для порівняння: заповнений зв'язок (документ з `createdAt`) стає id, дата стає ISO,
 * `null` і відсутнє значення однакові, порядок ключів не важливий.
 */
const normalize = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('id' in record && 'createdAt' in record) return String(record.id)
    if (typeof (record as { toHexString?: unknown }).toHexString === 'function') return String(value)

    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => key !== 'createdAt' && key !== 'updatedAt')
        .sort()
        .map((key) => [key, normalize(record[key])])
        .filter(([, item]) => item !== null),
    )
  }
  if (typeof value === 'number') return value
  return String(value)
}

const same = (next: unknown, prev: unknown) => JSON.stringify(normalize(next)) === JSON.stringify(normalize(prev))

/**
 * Менеджер змінює статус замовлення лише переходом `pending → shipped` (розд. 11, В9).
 * Поля він може змінити лише в замовленні, що чекає відвантаження й не оплачене (В21):
 * ціни, суму й виручку тоді перераховують хуки, а поля без права на запис (ціна позиції, склад,
 * облікові) Payload уже прибрав з `data` (field access). В іншому замовленні будь-яка зміна поля
 * відхиляється. Має йти першим у `beforeChange`.
 */
export const guardManagerOrderUpdate: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || !originalDoc || !isManager(req.user)) return data

  const reject = () => {
    throw new APIError(customT(req.t)('custom:error:managerOrderTransition'), 403, undefined, true)
  }

  if (!isOrderEditable(originalDoc)) {
    for (const key of Object.keys(data)) {
      if (IGNORED_KEYS.has(key) || key === 'status') continue
      if (!same(data[key], originalDoc[key])) reject()
    }
  }

  const status = data.status ?? originalDoc.status
  if (status !== originalDoc.status && !(originalDoc.status === 'pending' && status === 'shipped')) reject()

  return data
}
