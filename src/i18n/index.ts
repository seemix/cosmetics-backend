import { en } from './en'
import { pluginEcommerceRo, pluginEcommerceRu } from './pluginEcommerce'
import { ro } from './ro'
import { ru } from './ru'

/** Для `i18n.translations` у `payload.config.ts`. */
export const customTranslations = { en, ru: { ...ru, ...pluginEcommerceRu }, ro: { ...ro, ...pluginEcommerceRo } }

export { en, ro, ru }
export { pluginEcommerceRo, pluginEcommerceRu }
export { collectionLabels, customT, description, label, localized } from './labels'
export type { CustomTranslationsKeys, CustomTranslationsObject } from './types'
