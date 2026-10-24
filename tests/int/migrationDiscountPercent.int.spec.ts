import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { down, up } from '@/migrations/20261024_074830_rename_promo_discount_percent'

let payload: Payload

describe('міграція T32: discount % -> discountPercent', () => {
  const code = `MIGRATION-${Date.now()}`
  const raw = () => payload.db.collections['promo-codes'].collection
  const args = () => ({ payload, req: {} as never, session: undefined })

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    // Документ у старому форматі, як у наявних даних.
    await raw().insertOne({ code, 'discount %': 15, wholesale: false, isActive: true })
  })

  afterAll(async () => {
    await raw().deleteOne({ code })
  })

  it('up перейменовує поле, down повертає назад', async () => {
    await up(args())
    let doc = await raw().findOne({ code })
    expect(doc?.discountPercent).toBe(15)
    expect(doc).not.toHaveProperty('discount %')

    await down(args())
    doc = await raw().findOne({ code })
    expect(doc?.['discount %']).toBe(15)
    expect(doc).not.toHaveProperty('discountPercent')

    // Лишаємо тестову БД у новому форматі.
    await up(args())
    const promo = await payload.find({ collection: 'promo-codes', where: { code: { equals: code } } })
    expect(promo.docs[0]?.discountPercent).toBe(15)
  })
})
