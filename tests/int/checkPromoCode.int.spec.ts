import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { checkPromoCode } from '@/collections/Carts/services/checkPromoCode'

import { makeRequest, TestData } from './helpers/fixtures'

let payload: Payload
let data: TestData
let req: PayloadRequest

describe('checkPromoCode', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    req = makeRequest(payload)
  })

  afterAll(async () => {
    await data.cleanup()
  })

  it('порожній код відхиляється без запиту в БД', async () => {
    const result = await checkPromoCode({ req, promoCode: '   ', wholesale: false })

    expect(result).toEqual({ success: false, error: 'Promo code is required' })
  })

  it('невідомий код', async () => {
    const result = await checkPromoCode({ req, promoCode: 'NO-SUCH-CODE', wholesale: false })

    expect(result).toEqual({ success: false, error: 'Promo not found' })
  })

  it('активний роздрібний код проходить, пробіли по краях обрізаються', async () => {
    const promo = await data.promo()
    const result = await checkPromoCode({ req, promoCode: `  ${promo.code}  `, wholesale: false })

    expect(result.success).toBe(true)
    if (result.success) expect(result.promo.id).toBe(promo.id)
  })

  it('неактивний код', async () => {
    const promo = await data.promo({ isActive: false })
    const result = await checkPromoCode({ req, promoCode: promo.code, wholesale: false })

    expect(result).toEqual({ success: false, error: 'Promo is not active' })
  })

  it('оптовий код не діє для роздрібного покупця і навпаки', async () => {
    const wholesalePromo = await data.promo({ wholesale: true })
    const retailPromo = await data.promo({ wholesale: false })

    expect(await checkPromoCode({ req, promoCode: wholesalePromo.code, wholesale: false })).toEqual({
      success: false,
      error: 'Promo not valid',
    })
    expect(await checkPromoCode({ req, promoCode: retailPromo.code, wholesale: true })).toEqual({
      success: false,
      error: 'Promo not valid',
    })
    expect((await checkPromoCode({ req, promoCode: wholesalePromo.code, wholesale: true })).success).toBe(true)
  })

  it('прострочений код', async () => {
    const promo = await data.promo({ expirationDate: new Date(Date.now() - 60_000).toISOString() })
    const result = await checkPromoCode({ req, promoCode: promo.code, wholesale: false })

    expect(result).toEqual({ success: false, error: 'Promo expired' })
  })

  it('код з датою в майбутньому діє', async () => {
    const promo = await data.promo({ expirationDate: new Date(Date.now() + 3_600_000).toISOString() })
    const result = await checkPromoCode({ req, promoCode: promo.code, wholesale: false })

    expect(result.success).toBe(true)
  })
})
