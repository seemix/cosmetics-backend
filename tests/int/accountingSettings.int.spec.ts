import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'

let payload: Payload
let previous: { stockControlEnabled: boolean; accountingStartAt: string | null }

const settings = (patch: Record<string, unknown>) =>
  payload.updateGlobal({ slug: 'accounting-settings', data: patch as never, depth: 0 })

describe('Налаштування обліку: дата початку обліку', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const before = await payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    previous = { stockControlEnabled: before.stockControlEnabled ?? false, accountingStartAt: before.accountingStartAt ?? null }
  })

  afterAll(async () => {
    await settings({ stockControlEnabled: false })
    await settings(previous)
  })

  it('перше вмикання контролю залишків ставить accountingStartAt; повторне не змінює', async () => {
    await settings({ stockControlEnabled: false })
    await settings({ accountingStartAt: null })

    const from = Date.now()
    const enabled = await settings({ stockControlEnabled: true })
    const stamped = enabled.accountingStartAt
    expect(stamped).toBeTruthy()
    expect(new Date(stamped!).getTime()).toBeGreaterThanOrEqual(from - 1000)

    await settings({ stockControlEnabled: false })
    const again = await settings({ stockControlEnabled: true })
    expect(again.accountingStartAt).toBe(stamped)
  })

  it('явно задану дату при вмиканні хук не перезаписує', async () => {
    await settings({ stockControlEnabled: false })
    await settings({ accountingStartAt: null })

    const at = '2026-01-15T08:00:00.000Z'
    const enabled = await settings({ stockControlEnabled: true, accountingStartAt: at })
    expect(new Date(enabled.accountingStartAt!).toISOString()).toBe(at)
  })
})
