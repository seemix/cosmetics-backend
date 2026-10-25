import { initI18n } from '@payloadcms/translations'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import config from '@/payload.config'
import { documentLifecycle } from '@/services/documents/documentLifecycle'

let payload: Payload

const lifecycle = documentLifecycle({ prefix: 'I18N', counterKey: 'I18N' })
const [beforeChange] = lifecycle.hooks.beforeChange

const admin = { id: 'test-admin', roles: ['admin'], collection: 'users' }

const translatorFor = async (language: 'en' | 'ru' | 'ro') =>
  (await initI18n({ config: payload.config.i18n, context: 'api', language })).t

/** Виклик хука з мовою адмінки `language`: повертає текст помилки. */
const messageOf = async (language: 'en' | 'ru' | 'ro', data: Record<string, unknown>, originalDoc: Record<string, unknown>) => {
  const req = await createLocalReq({ user: admin as never }, payload)
  req.t = await translatorFor(language)

  try {
    await beforeChange({ collection: { slug: 'test-docs' }, context: {}, data, operation: 'update', originalDoc, req } as never)
  } catch (error) {
    return (error as Error).message
  }

  return undefined
}

describe('I2: тексти помилок хуків залежать від мови адмінки', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it.each([
    ['en', 'A reversed document is final, create a new document instead'],
    ['ru', 'Сторнированный документ окончателен, создайте новый документ'],
    ['ro', 'Documentul stornat este final, creați un document nou'],
  ] as const)('сторнований документ: %s', async (language, expected) => {
    const doc = { id: 'doc-1', status: 'reversed' }

    expect(await messageOf(language, { ...doc, status: 'posted' }, doc)).toBe(expected)
  })

  it.each([
    ['en', 'A posted document cannot be changed (comment)'],
    ['ru', 'Проведённый документ нельзя изменить (comment)'],
    ['ro', 'Un document operat nu poate fi modificat (comment)'],
  ] as const)('зміна проведеного документа з полями в тексті: %s', async (language, expected) => {
    const doc = { id: 'doc-1', status: 'posted', comment: 'a' }

    expect(await messageOf(language, { ...doc, comment: 'b' }, doc)).toBe(expected)
  })
})
