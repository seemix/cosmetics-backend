import { en } from './en'
import { pluginEcommerceRo, pluginEcommerceRu } from './pluginEcommerce'
import { ro } from './ro'
import { ru } from './ru'

/** Для `i18n.translations` у `payload.config.ts`. */
export const customTranslations = {
  en: { ...en, general: { payloadSettings: 'Dashboard settings' } },
  ru: {
    ...ru,
    ...pluginEcommerceRu,
    // Без «новый»: «Создать Касса» вместо «Создать новый касса» (согласование рода не работает с подставным названием).
    general: { payloadSettings: 'Настройки панели', createNewLabel: 'Создать {{label}}', creatingNewLabel: 'Создание {{label}}' },
  },
  ro: { ...ro, ...pluginEcommerceRo, general: { payloadSettings: 'Setările panoului' } },
}

export { en, ro, ru }
export { pluginEcommerceRo, pluginEcommerceRu }
export { collectionLabels, customT, description, label, localized } from './labels'
export type { CustomTranslationsKeys, CustomTranslationsObject } from './types'
