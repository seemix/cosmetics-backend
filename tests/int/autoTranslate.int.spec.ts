import * as deepl from 'deepl-node'
import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData

describe('autoTranslate (Products afterChange)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    // Глобальний мок DeepL у vitest.setup.ts повертає порожній результат, тож хук
    // не доходить до payload.update. Тут підміняємо переклад, щоб пройти цей шлях.
    vi.spyOn(deepl.Translator.prototype, 'translateText').mockImplementation(
      (async (text: string) => ({ text: `RO:${text}` })) as never,
    )
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  it('записує переклад ro в тій самій транзакції, що й створення товару', async () => {
    const brand = await data.brand()
    const product = await data.product({ brand: brand.id, retailPrice: 100, subtitle: 'Русский' })

    const ro = await payload.findByID({
      collection: 'products',
      id: product.id,
      locale: 'ro',
      fallbackLocale: false,
      depth: 0,
    })
    const ru = await payload.findByID({
      collection: 'products',
      id: product.id,
      locale: 'ru',
      depth: 0,
    })

    expect(ro.subtitle).toBe('RO:Русский')
    expect(ru.subtitle).toBe('Русский')
  })
})
