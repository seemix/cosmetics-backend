import { CollectionAfterChangeHook } from 'payload'
import * as deepl from 'deepl-node'

import { EXTERNAL_TIMEOUT_MS, withTimeout } from '@/services/notifications/withTimeout'

let translator: deepl.Translator | undefined

/** Перекладач створюється при першому перекладі. Без `DEEPL_KEY` повертає null. */
const getTranslator = (): deepl.Translator | null => {
  const authKey = process.env.DEEPL_KEY
  if (!authKey) return null
  translator ??= new deepl.Translator(authKey)
  return translator
}

export const autoTranslate: CollectionAfterChangeHook = async ({
                                                                 doc,
                                                                 previousDoc,
                                                                 req,
                                                                 collection
                                                               }) => {
  if (req.locale !== 'ru') return

  const translator = getTranslator()
  if (!translator) {
    req.payload.logger.warn('DEEPL_KEY is not set, auto-translation ru -> ro skipped')
    return
  }

  const fieldsToTranslate = ['subtitle', 'shortDescription']
  const translatedData: Record<string, string> = {}

  for (const field of fieldsToTranslate) {
    const newValue = doc[field]
    const oldValue = previousDoc?.[field]

    if (newValue && newValue !== oldValue) {
      try {
        const result = await withTimeout(
          translator.translateText(newValue, 'ru', 'ro'),
          EXTERNAL_TIMEOUT_MS,
          'DeepL',
        )
        if ('text' in result) {
          translatedData[field] = result.text
        }
      } catch (e) {
        req.payload.logger.error({ err: e }, `Error translating ${field}`)
      }
    }
  }

  if (Object.keys(translatedData).length === 0) return

  // `req` потрібен, щоб update виконався в тій самій транзакції, що й збереження документа.
  // createLocalReq записує `locale` у передану req, тому після виклику повертаємо початкову.
  const { locale, fallbackLocale } = req
  try {
    await req.payload.update({
      collection: collection.slug,
      id: doc.id,
      locale: 'ro',
      data: translatedData,
      depth: 0,
      req
    })
  } finally {
    req.locale = locale
    req.fallbackLocale = fallbackLocale
  }
}
