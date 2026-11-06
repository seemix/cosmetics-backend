import axios from 'axios'
import { getPayload, type Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import config from '@/payload.config'
import { withTimeout } from '@/services/notifications/withTimeout'

import { TestData } from './helpers/fixtures'
import { callCreateOrder, loadOrder, shippingAddress, silenceSideEffects } from './helpers/orderCall'

let payload: Payload
let data: TestData

describe('сповіщення про замовлення: зовнішні сервіси', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    data = new TestData(payload)
    silenceSideEffects(payload)
    vi.spyOn(payload.logger, 'error')
    vi.spyOn(payload.logger, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.mocked(payload.sendEmail).mockReset().mockResolvedValue(undefined as never)
    vi.mocked(payload.logger.error).mockClear()
    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await data.cleanup()
    vi.restoreAllMocks()
  })

  const orderBody = async () => {
    const brand = await data.brand()
    const product = await data.product({ brand: brand.id, retailPrice: 100 })
    return { items: [{ product: product.id, quantity: 1 }], shippingAddress }
  }

  it('збій пошти не ламає створення замовлення і пишеться в лог', async () => {
    vi.mocked(payload.sendEmail).mockRejectedValue(new Error('Resend is down'))

    const { status, body } = await callCreateOrder(payload, { body: await orderBody() })

    expect(status).toBe(201)
    expect(await loadOrder(payload, data, body.order.id)).toBeTruthy()
    expect(payload.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Email sending failed'),
    )
  })

  it('збій Telegram не ламає створення замовлення і пишеться в лог', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat')
    const post = vi.spyOn(axios, 'post').mockRejectedValue(new Error('timeout of 10000ms exceeded'))

    try {
      const { status, body } = await callCreateOrder(payload, { body: await orderBody() })

      expect(status).toBe(201)
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.anything(),
        expect.objectContaining({ timeout: expect.any(Number) }),
      )
      expect(await loadOrder(payload, data, body.order.id)).toBeTruthy()
      expect(payload.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Notification hook error'),
      )
    } finally {
      post.mockRestore()
    }
  })

  it('пише в лог причину відмови Telegram', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat')
    const telegramError = new axios.AxiosError('Request failed with status code 400')
    telegramError.response = {
      data: { ok: false, description: "Bad Request: can't parse entities" },
    } as never
    const post = vi.spyOn(axios, 'post').mockRejectedValue(telegramError)

    try {
      const { status } = await callCreateOrder(payload, { body: await orderBody() })

      expect(status).toBe(201)
      expect(payload.logger.error).toHaveBeenCalledWith(
        expect.stringContaining("can't parse entities"),
      )
    } finally {
      post.mockRestore()
    }
  })

  it('екранує HTML у даних замовлення для Telegram', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat')
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { result: { message_id: 7 } } })

    try {
      const body = await orderBody()
      const { status } = await callCreateOrder(payload, {
        body: {
          ...body,
          shippingAddress: { ...shippingAddress, address: 'Str. A & B <bloc 2>' },
          comment: 'до <14:00> & після',
        },
      })

      expect(status).toBe(201)
      const text = (post.mock.calls[0][1] as { text: string }).text
      expect(text).toContain('Str. A &amp; B &lt;bloc 2&gt;')
      expect(text).toContain('до &lt;14:00&gt; &amp; після')
      expect(text).toContain('<b>🛒 Новый заказ')
    } finally {
      post.mockRestore()
    }
  })

  it('після коміту зберігає id повідомлення Telegram у замовленні', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    vi.stubEnv('TELEGRAM_CHAT_ID', 'test-chat')
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { result: { message_id: 42 } } })

    try {
      const { status, body } = await callCreateOrder(payload, { body: await orderBody() })

      expect(status).toBe(201)
      expect((await loadOrder(payload, data, body.order.id)).telegramMessageId).toBe('42')
    } finally {
      post.mockRestore()
    }
  })

  it('для відкоченого замовлення сповіщення не надсилаються', async () => {
    const before = (await payload.count({ collection: 'orders' })).totalDocs

    // Штучна помилка після запису замовлення: транзакція відкочується.
    const findByID = payload.findByID.bind(payload)
    const spy = vi.spyOn(payload, 'findByID').mockImplementation((async (
      args: Parameters<typeof payload.findByID>[0],
    ) => {
      if (args.collection === 'orders') throw new Error('Injected failure')
      return findByID(args)
    }) as typeof payload.findByID)

    try {
      const { status } = await callCreateOrder(payload, { body: await orderBody() })
      expect(status).toBe(500)
    } finally {
      spy.mockRestore()
    }

    expect((await payload.count({ collection: 'orders' })).totalDocs).toBe(before)
    expect(payload.sendEmail).not.toHaveBeenCalled()
  })
})

describe('withTimeout', () => {
  it('відхиляє проміс, який не відповів вчасно', async () => {
    vi.useFakeTimers()
    try {
      const pending = withTimeout(new Promise(() => {}), 1000, 'Test')
      const assertion = expect(pending).rejects.toThrow('Test: no response in 1000 ms')
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('повертає результат, якщо сервіс відповів вчасно', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'Test')).resolves.toBe('ok')
  })
})
