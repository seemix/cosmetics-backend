import type { TFunction } from '@payloadcms/translations'
import type { LabelFunction } from 'payload'

import { en } from './en'
import { ro } from './ro'
import { ru } from './ru'
import type { CustomTranslationsKeys, CustomTranslationsObject } from './types'

/** Мови адмінки, у порядку, у якому їх віддає `localized`. */
const dictionaries: Record<'en' | 'ru' | 'ro', CustomTranslationsObject> = { en, ru, ro }

/**
 * `req.t` / `t` з Payload типізований лише ключами самого Payload. Ця обгортка додає ключі словника:
 * `customT(req.t)('custom:validation:integer')`.
 */
export const customT = (t: unknown): TFunction<CustomTranslationsKeys> => t as TFunction<CustomTranslationsKeys>

/**
 * Мітка з ключа словника для `label`, `labels.singular/plural` і `options[].label`.
 * Перекладається за мовою адмінки в момент показу.
 */
export const label =
  (key: CustomTranslationsKeys): LabelFunction =>
  ({ t }) =>
    customT(t)(key)

/** Те саме для `admin.description` полів. */
export const description = label

/** Пара `labels` колекції: `labels: collectionLabels('custom:...:singular', 'custom:...:plural')`. */
export const collectionLabels = (singular: CustomTranslationsKeys, plural: CustomTranslationsKeys) => ({
  singular: label(singular),
  plural: label(plural),
})

const lookup = (dictionary: CustomTranslationsObject, key: string): string | undefined => {
  const value = key.split(':').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    dictionary,
  )

  return typeof value === 'string' ? value : undefined
}

/**
 * Об'єкт `{ en, ru, ro }` для місць, де Payload не приймає функцію, насамперед `admin.group`
 * (колекцій і глобалів). Кидає помилку під час завантаження конфігу, якщо ключа немає в мові.
 */
export const localized = (key: CustomTranslationsKeys): Record<string, string> =>
  Object.fromEntries(
    Object.entries(dictionaries).map(([language, dictionary]) => {
      const text = lookup(dictionary, key)
      if (text === undefined) throw new Error(`Missing translation "${key}" for language "${language}"`)

      return [language, text]
    }),
  )
