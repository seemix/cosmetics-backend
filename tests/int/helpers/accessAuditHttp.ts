import { getPayload, handleEndpoints, type Payload } from 'payload'
import { vi } from 'vitest'

import config from '@/payload.config'

import { TestData } from './fixtures'
import { silenceSideEffects } from './orderCall'
import type { AuthUser } from './stock'

/**
 * Спільна основа тестів аудиту доступу (R3): фікстури користувачів і REST-запити з токенами
 * admin / manager / customer / без токена, як у `accessMatrix.int.spec.ts`.
 */

export type Who = 'guest' | 'customer' | 'manager' | 'admin'
export const WHO: Who[] = ['guest', 'customer', 'manager', 'admin']

export const PASSWORD = 'test-password-123'

/** Валідний за формою, але неіснуючий ObjectId: `403` = доступу немає, `404`/`400` = доступ є, документа немає. */
export const MISSING_ID = 'ffffffffffffffffffffffff'

export type Actors = {
  admin: AuthUser
  manager: AuthUser
  manager2: AuthUser
  customer: AuthUser
  customer2: AuthUser
}

export type Http = {
  status: number
  /** Тіло відповіді: JSON або текст (до 300 символів), якщо не JSON. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  headers: Headers
}

export type AuditContext = {
  payload: Payload
  data: TestData
  actors: Actors
  /** Запит до REST як `who` (користувач або гість). */
  http: (method: string, path: string, who: Who | AuthUser, body?: unknown) => Promise<Http>
  /** Запит до GraphQL як `who`. */
  gql: (query: string, who?: Who | AuthUser) => Promise<{ status: number; body: any }>
  userOf: (who: Who) => AuthUser | undefined
  makeUser: (roles: Array<'admin' | 'manager' | 'customer'>, options?: { wholesale?: boolean; manager?: string }) => Promise<AuthUser>
}

export const idOf = (value: unknown): string =>
  String(typeof value === 'object' && value ? (value as { id: unknown }).id : value)

export const setupAudit = async (): Promise<AuditContext> => {
  const payload = await getPayload({ config: await config })
  const data = new TestData(payload)
  silenceSideEffects(payload)
  // Реєстрація й верифікація шлють лист через адаптер email, не через `payload.sendEmail`.
  vi.spyOn(payload.email as unknown as { sendEmail: () => Promise<void> }, 'sendEmail').mockResolvedValue(undefined)

  const tokens = new Map<string, string>()

  const makeUser: AuditContext['makeUser'] = async (roles, options = {}) => {
    const user = await data.user({ wholesale: options.wholesale })
    const updated = await payload.update({
      collection: 'users',
      id: user.id,
      data: { roles, _verified: true, ...(options.manager ? { manager: options.manager } : {}) } as never,
    })
    return { ...updated, collection: 'users' } as AuthUser
  }

  const actors: Actors = {
    admin: await makeUser(['admin']),
    manager: await makeUser(['manager']),
    manager2: await makeUser(['manager']),
    customer: await makeUser(['customer']),
    customer2: await makeUser(['customer']),
  }

  const userOf = (who: Who): AuthUser | undefined => (who === 'guest' ? undefined : actors[who])

  const authHeader = async (who: Who | AuthUser): Promise<Record<string, string>> => {
    const user = typeof who === 'string' ? userOf(who) : who
    if (!user) return {}
    if (!tokens.has(user.email)) {
      const { token } = await payload.login({ collection: 'users', data: { email: user.email, password: PASSWORD } })
      tokens.set(user.email, token!)
    }
    return { Authorization: `Bearer ${tokens.get(user.email)}` }
  }

  const http: AuditContext['http'] = async (method, path, who, body) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeader(who)) }
    const response = await handleEndpoints({
      config: await config,
      request: new Request(`http://localhost/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    })
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text.slice(0, 300)
    }
    return { status: response.status, body: parsed, headers: response.headers }
  }

  const gql: AuditContext['gql'] = async (query, who = 'guest') => {
    const { GRAPHQL_POST } = await import('@payloadcms/next/routes')
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeader(who)) }
    const handler = GRAPHQL_POST(config) as (request: Request) => Promise<Response>
    const response = await handler(
      new Request('http://localhost/api/graphql', { method: 'POST', headers, body: JSON.stringify({ query }) }),
    )
    const text = await response.text()
    try {
      return { status: response.status, body: JSON.parse(text) }
    } catch {
      return { status: response.status, body: text.slice(0, 300) }
    }
  }

  return { payload, data, actors, http, gql, userOf, makeUser }
}

/** Усі ключі об'єкта на всіх рівнях вкладеності (для перевірки, що відповідь не містить заборонених полів). */
export const deepKeys = (node: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(node)) node.forEach((item) => deepKeys(item, out))
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      out.add(key)
      deepKeys(value, out)
    }
  }
  return out
}

/** Чи дозволила операція доступ: не 401/403 і не «не реалізовано» (501, REST вимкнено). */
export const allowedStatus = (status: number) => ![401, 403, 501].includes(status)
