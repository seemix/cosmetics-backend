import { en } from './en'
import { ro } from './ro'
import { ru } from './ru'

/** Для `i18n.translations` у `payload.config.ts`. */
export const customTranslations = { en, ru, ro }

export { en, ro, ru }
export { collectionLabels, customT, description, label, localized } from './labels'
export type { CustomTranslationsKeys, CustomTranslationsObject } from './types'
