import { appendFileSync } from 'fs'

import { initI18n } from '@payloadcms/translations'
import { getPayload, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { pluginEcommerceRo, pluginEcommerceRu } from '@/i18n'
import config from '@/payload.config'

import { en as pluginEn } from '@payloadcms/plugin-ecommerce/translations'

let payload: Payload

const languages = ['en', 'ru', 'ro'] as const

/**
 * Власність плагіна ecommerce (колекції без власного файлу в `src/collections` і поля плагіна):
 * їхні назви перекладає сам плагін. Тут перевіряються лише наші конфіги.
 */
const pluginCollections = new Set(['variants', 'variantTypes', 'variantOptions', 'addresses', 'transactions'])

/** Колекції, які ще не перекладені (список зменшується з кожним комітом I2 і наприкінці порожній). */
const pending = new Set<string>(process.env.I18N_ALL ? [] : ['accounting-settings'])

type Problem = string

type AnyField = {
  type: string
  name?: string
  label?: unknown
  fields?: AnyField[]
  tabs?: { label?: unknown; name?: string; fields: AnyField[] }[]
  blocks?: { slug: string; labels?: { singular?: unknown; plural?: unknown }; fields: AnyField[] }[]
  options?: unknown[]
  hidden?: boolean
  admin?: { description?: unknown; hidden?: boolean }
}

/** Рядок замість функції означає мітку, яку Payload вивів із `name` (англійською для всіх мов) або яку написали напряму. */
const isTranslatable = (value: unknown) => typeof value === 'function' || (typeof value === 'object' && value !== null)

const resolve = async (value: unknown, language: (typeof languages)[number]) => {
  const t = (await initI18n({ config: payload.config.i18n, context: 'api', language })).t
  if (typeof value === 'function') return (value as (args: unknown) => unknown)({ t, i18n: { t, language } })
  if (value && typeof value === 'object') return (value as Record<string, unknown>)[language]
  return value
}

const check = async (where: string, value: unknown, problems: Problem[]) => {
  if (value === false) return
  if (!isTranslatable(value)) {
    problems.push(`${where}: рядок без перекладу (${JSON.stringify(value)})`)
    return
  }
  for (const language of languages) {
    let text: unknown
    try {
      text = await resolve(value, language)
    } catch (error) {
      problems.push(`${where} [${language}]: label() кидає ${(error as Error).message}`)
      continue
    }
    if (typeof text !== 'string' || !text.trim()) problems.push(`${where} [${language}]: порожній текст`)
    else if (/^[A-Za-z-]+(:[A-Za-z0-9_]+)+$/.test(text)) problems.push(`${where} [${language}]: сирий ключ ${text}`)
  }
}

const walk = async (fields: AnyField[], where: string, problems: Problem[]) => {
  for (const field of fields) {
    // Приховані поля в адмінці не видно; `id` рядків масивів Payload додає сам.
    if ((field as AnyField & { hidden?: boolean }).hidden || field.admin?.hidden || field.name === 'id') continue
    const name = field.name ?? field.type
    const path = `${where}.${name}`
    // Службові поля Payload (id, дати, пароль, upload) мають власні переклади.
    const hasData = field.type !== 'ui' && field.type !== 'row' && field.type !== 'collapsible' && field.type !== 'tabs'
    if (field.name && hasData && field.type !== 'tab') await check(`${path}.label`, field.label, problems)
    if (field.type === 'collapsible') await check(`${path}.label`, field.label, problems)
    if (field.admin?.description !== undefined) await check(`${path}.admin.description`, field.admin.description, problems)

    // Коди валют (`currency`) не перекладаються.
    for (const [index, option] of field.name === 'currency' ? [] : (field.options ?? []).entries()) {
      const label = typeof option === 'object' && option !== null ? (option as { label?: unknown }).label : option
      await check(`${path}.options[${index}].label`, label, problems)
    }
    for (const tab of field.tabs ?? []) {
      await check(`${path}.tab(${tab.name ?? ''}).label`, tab.label, problems)
      await walk(tab.fields, `${path}.tab`, problems)
    }
    for (const block of field.blocks ?? []) {
      await check(`${path}.block(${block.slug}).labels.singular`, block.labels?.singular, problems)
      await walk(block.fields, `${path}.block(${block.slug})`, problems)
    }
    if (field.fields) await walk(field.fields, path, problems)
  }
}

const report = (problems: Problem[]) => {
  if (process.env.I18N_REPORT) appendFileSync(process.env.I18N_REPORT, `${problems.join('\n')}\n`)
}

const adminOf = (entity: { admin?: Record<string, unknown> }) => entity.admin ?? {}

describe('I2: усі label мають переклад (en, ru, ro)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('колекції: labels, group, description, поля, options, tabs', async () => {
    const problems: Problem[] = []

    for (const collection of payload.config.collections) {
      if (pluginCollections.has(collection.slug) || collection.slug.startsWith('payload-')) continue
      if (pending.has(collection.slug) || adminOf(collection).hidden) continue
      const where = `collections.${collection.slug}`

      await check(`${where}.labels.singular`, collection.labels.singular, problems)
      await check(`${where}.labels.plural`, collection.labels.plural, problems)
      const { group, description } = adminOf(collection)
      if (group !== undefined && group !== false) await check(`${where}.admin.group`, group, problems)
      if (description !== undefined) await check(`${where}.admin.description`, description, problems)
      await walk(collection.fields as AnyField[], where, problems)
    }

    report(problems)
    expect(problems).toEqual([])
  })

  it('plugin-ecommerce: ru і ro мають усі ключі англійського набору плагіна', () => {
    const keys = Object.keys(pluginEn['plugin-ecommerce']).sort()

    expect(Object.keys(pluginEcommerceRu['plugin-ecommerce']).sort()).toEqual(keys)
    expect(Object.keys(pluginEcommerceRo['plugin-ecommerce']).sort()).toEqual(keys)
  })

  it('глобали: label, group, поля', async () => {
    const problems: Problem[] = []

    for (const global of payload.config.globals) {
      if (pending.has(global.slug)) continue
      const where = `globals.${global.slug}`
      await check(`${where}.label`, global.label, problems)
      const { group, description } = adminOf(global)
      if (group !== undefined && group !== false) await check(`${where}.admin.group`, group, problems)
      if (description !== undefined) await check(`${where}.admin.description`, description, problems)
      await walk(global.fields as AnyField[], where, problems)
    }

    report(problems)
    expect(problems).toEqual([])
  })
})
