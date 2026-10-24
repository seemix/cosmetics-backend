import { afterEach, describe, expect, it, vi } from 'vitest'

/** Завантажує конфіг заново з поточними змінними оточення. */
const loadConfig = async () => {
  vi.resetModules()
  const { default: config } = await import('@/payload.config')
  return config
}

describe('payload.config: email', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('з RESEND_API_KEY використовує адаптер Resend', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key')
    expect((await loadConfig()).email).toBeTypeOf('function')
  })

  it('без RESEND_API_KEY адаптера немає: Payload бере консольний транспорт', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect((await loadConfig()).email).toBeUndefined()
  })
})
