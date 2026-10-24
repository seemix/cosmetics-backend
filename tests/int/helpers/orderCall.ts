import type { Payload } from 'payload'
import { vi } from 'vitest'

import { createOrder } from '@/collections/Orders/endpoints/createOrder'

import { makeRequest, type TestData } from './fixtures'

export const shippingAddress = {
  name: 'Test',
  phone: '+37360000000',
  email: 'buyer@example.test',
  city: 'Chisinau',
  address: 'Str. 1',
}

/** Викликає хендлер createOrder напряму й повертає статус та тіло відповіді. */
export async function callCreateOrder(
  payload: Payload,
  options: { user?: unknown; body: unknown },
) {
  const response = (await createOrder.handler(makeRequest(payload, options))) as Response
  return { status: response.status, body: (await response.json()) as any }
}

/** Завантажує створене замовлення й реєструє його для очищення. */
export async function loadOrder(payload: Payload, data: TestData, id: string | number) {
  data.trackOrder(id)
  return payload.findByID({ collection: 'orders', id, depth: 0 })
}

/** Вимикає листи й шум у консолі: хук сповіщень викликає payload.sendEmail. */
export function silenceSideEffects(payload: Payload) {
  vi.spyOn(payload, 'sendEmail').mockResolvedValue(undefined as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
}
