import { initI18n } from '@payloadcms/translations'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { validateBani } from '@/fields/money'
import { collectionLabels, customT, en, label, localized, ro, ru } from '@/i18n'
import config from '@/payload.config'

let payload: Payload

const dictionaries = { en, ru, ro }

/** Усі ключі словника у вигляді `custom:status:draft`. */
const flatten = (node: unknown, prefix = ''): string[] =>
  Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}:`),
  )

const valueAt = (node: unknown, key: string) =>
  key.split(':').reduce<unknown>((current, part) => (current as Record<string, unknown> | undefined)?.[part], node)

const translatorFor = async (language: 'en' | 'ru' | 'ro') =>
  (await initI18n({ config: payload.config.i18n, context: 'api', language })).t

describe('I0: багатомовність адмінки', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  describe('налаштування', () => {
    it('supportedLanguages: en, ru, ro', () => {
      expect(Object.keys(payload.config.i18n.supportedLanguages).sort()).toEqual(['en', 'ro', 'ru'])
    })

    it('fallbackLanguage: en (мова міток у коді)', () => {
      expect(payload.config.i18n.fallbackLanguage).toBe('en')
    })

    it('мови контенту товарів не змінилися', () => {
      const localization = payload.config.localization
      expect(localization && localization.defaultLocale).toBe('ru')
      expect(localization && localization.localeCodes).toEqual(['ru', 'ro'])
    })
  })

  describe('словник', () => {
    const keys = flatten(en)

    it('не порожній', () => {
      expect(keys.length).toBeGreaterThan(20)
    })

    it.each(['ru', 'ro'] as const)('%s: усі ключі en присутні, текст непорожній і без зайвих ключів', (language) => {
      expect(flatten(dictionaries[language]).sort()).toEqual([...keys].sort())

      for (const key of keys) {
        const text = valueAt(dictionaries[language], key)
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${key}`).toBe(true)
      }
    })

    it.each([
      ['custom:status:draft', 'Draft', 'Черновик', 'Ciornă'],
      ['custom:status:posted', 'Posted', 'Проведён', 'Operat'],
      ['custom:status:reversed', 'Reversed', 'Сторнирован', 'Stornat'],
      ['custom:term:warehouse', 'Warehouse', 'Склад', 'Depozit'],
      ['custom:term:cost', 'Cost price', 'Себестоимость', 'Preț de cost'],
      ['custom:action:reverse', 'Reversal', 'Сторно', 'Stornare'],
      ['custom:period:closed', 'Closed period', 'Закрытый период', 'Perioadă închisă'],
    ])('%s перекладається через t() для кожної мови', async (key, textEn, textRu, textRo) => {
      for (const [language, expected] of [
        ['en', textEn],
        ['ru', textRu],
        ['ro', textRo],
      ] as const) {
        const t = await translatorFor(language)
        // Відсутній ключ Payload не перекладає й не підставляє іншу мову: t() повертає сам ключ.
        expect(t(key as never), `${language}: ${key}`).toBe(expected)
      }
    })
  })

  describe('labels', () => {
    it('label(): мітка залежить від мови адмінки', async () => {
      const draft = label('custom:status:draft')

      for (const [language, expected] of [
        ['en', 'Draft'],
        ['ru', 'Черновик'],
        ['ro', 'Ciornă'],
      ] as const) {
        const t = await translatorFor(language)
        expect(draft({ t, i18n: { t } as never })).toBe(expected)
      }
    })

    it('collectionLabels(): singular і plural', async () => {
      const labels = collectionLabels('custom:term:warehouse', 'custom:term:total')
      const t = await translatorFor('ru')

      expect((labels.singular as (args: never) => string)({ t, i18n: { t } } as never)).toBe('Склад')
      expect((labels.plural as (args: never) => string)({ t, i18n: { t } } as never)).toBe('Итого')
    })

    it('localized(): об’єкт з усіма мовами для admin.group', () => {
      expect(localized('custom:group:stock')).toEqual({ en: 'Stock', ru: 'Склад', ro: 'Depozit' })
      expect(localized('custom:group:purchasing')).toEqual({ en: 'Purchasing', ru: 'Закупки', ro: 'Achiziții' })
    })

    it('localized(): невідомий ключ кидає помилку під час завантаження конфігу', () => {
      expect(() => localized('custom:nope:nope' as never)).toThrow(/Missing translation/)
    })
  })

  describe('MoneyField: повідомлення валідації', () => {
    it.each([
      ['en', 'Amount must be a whole number of bani'],
      ['ru', 'Сумма должна быть целым числом бани'],
      ['ro', 'Suma trebuie să fie un număr întreg de bani'],
    ] as const)('%s', async (language, expected) => {
      const req = await createLocalReq({ fallbackLocale: false }, payload)
      req.t = await translatorFor(language)

      const result = await validateBani(10.5, { req } as never)

      expect(result).toBe(expected)
      expect(customT(req.t)('custom:validation:wholeBani')).toBe(expected)
    })

    it('ціле число проходить', async () => {
      const req = await createLocalReq({}, payload)

      expect(await validateBani(1050, { req } as never)).toBe(true)
    })
  })
})
