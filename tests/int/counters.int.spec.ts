import { getPayload, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { COUNTERS_COLLECTION, formatDocNumber, nextCounterValue } from '@/services/counters'

let payload: Payload
let req: PayloadRequest

const keys: string[] = []
const newKey = () => {
  const key = `test-counter-${Date.now()}-${keys.length}`
  keys.push(key)
  return key
}

describe('counters', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    req = { payload } as PayloadRequest
  })

  afterAll(async () => {
    await payload.db.connection
      .collection(COUNTERS_COLLECTION)
      .deleteMany({ _id: { $in: keys as never[] } })
  })

  it('новий ключ стартує з 1, далі +1', async () => {
    const key = newKey()

    expect(await nextCounterValue(req, key)).toBe(1)
    expect(await nextCounterValue(req, key)).toBe(2)
  })

  it('seed продовжує наявну нумерацію (число або функція)', async () => {
    const fromNumber = newKey()
    const fromFunction = newKey()

    expect(await nextCounterValue(req, fromNumber, 41)).toBe(42)
    expect(await nextCounterValue(req, fromFunction, async () => 99)).toBe(100)
    // seed діє лише при створенні лічильника
    expect(await nextCounterValue(req, fromFunction, 5000)).toBe(101)
  })

  it('паралельні виклики для нового ключа дають різні номери', async () => {
    const key = newKey()

    const values = await Promise.all(Array.from({ length: 10 }, () => nextCounterValue(req, key, 7)))

    expect(new Set(values).size).toBe(10)
    expect(values.sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => 8 + i))
  })

  it('formatDocNumber', () => {
    expect(formatDocNumber('PUR', 1)).toBe('PUR-000001')
    expect(formatDocNumber('CSH', 123456)).toBe('CSH-123456')
    expect(formatDocNumber('TRF', 1234567)).toBe('TRF-1234567')
  })
})
