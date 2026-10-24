import { CollectionAfterChangeHook } from 'payload'
import * as deepl from 'deepl-node'

const translator = new deepl.Translator(process.env.DEEPL_KEY as string)

export const autoTranslate: CollectionAfterChangeHook = async ({
                                                                 doc,
                                                                 previousDoc,
                                                                 req,
                                                                 collection
                                                               }) => {
  if (req.locale !== 'ru') return

  const fieldsToTranslate = ['subtitle', 'shortDescription']
  const translatedData: Record<string, string> = {}

  for (const field of fieldsToTranslate) {
    const newValue = doc[field]
    const oldValue = previousDoc?.[field]

    if (newValue && newValue !== oldValue) {
      try {
        const result = await translator.translateText(newValue, 'ru', 'ro')
        if ('text' in result) {
          translatedData[field] = result.text
        }
      } catch (e) {
        console.error(`Error translating ${field}:`, e)
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
