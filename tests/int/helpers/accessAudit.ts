/// <reference types="vite/client" />
import fs from 'node:fs'
import path from 'node:path'

import type { Field, SanitizedConfig } from 'payload'

/**
 * Інвентаризація для аудиту доступу (R3). Усе береться з реально завантаженого конфігу й
 * з вихідного коду, а не з пам'яті: таблиці звіту й тести повноти спираються на ці функції.
 */

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')

/** Дефолтний access Payload 3.65.0 (`Boolean(user)`): його пізнаємо за ідентичністю функції. */
const isDefaultAccess = (fn: unknown) => typeof fn === 'function' && fn.toString().replace(/\s/g, '') === '({req:{user}})=>Boolean(user)'

export type AccessRule = { kind: 'explicit' | 'default' | 'absent'; text: string }

const describeRule = (fn: unknown, op: string, required: boolean): AccessRule => {
  if (fn === undefined || fn === null) return { kind: 'absent', text: required ? 'не задано' : 'не задано' }
  if (typeof fn === 'boolean') return { kind: 'explicit', text: String(fn) }
  if (isDefaultAccess(fn)) return { kind: 'default', text: 'defaultAccess (Boolean(user))' }
  const name = (fn as { name?: string }).name
  return { kind: 'explicit', text: name && name !== op ? name : 'inline-функція' }
}

export const COLLECTION_OPS = ['create', 'read', 'update', 'delete'] as const
export const EXTRA_OPS = ['readVersions', 'unlock', 'admin'] as const

export type EntityInventory = {
  kind: 'collection' | 'global'
  slug: string
  access: Record<string, AccessRule>
  graphQL: 'on' | 'off'
  hidden: 'yes' | 'fn' | 'no'
  versions: 'drafts' | 'versions' | 'no'
  auth: boolean
  upload: boolean
}

export type FieldInventory = {
  entity: string
  path: string
  type: string
  access: string[]
  hidden: boolean
}

const hasGraphQLDisabled = (config: { graphQL?: unknown }) => config.graphQL === false

export const inventoryEntities = (config: SanitizedConfig): EntityInventory[] => {
  const rows: EntityInventory[] = []

  for (const collection of config.collections) {
    const access = (collection.access ?? {}) as Record<string, unknown>
    const rules: Record<string, AccessRule> = {}
    for (const op of [...COLLECTION_OPS, ...EXTRA_OPS]) {
      if (op === 'unlock' && !collection.auth) continue
      if (op === 'admin' && !collection.auth) continue
      if (op === 'readVersions' && !collection.versions) continue
      rules[op] = describeRule(access[op], op, true)
    }
    const hidden = collection.admin?.hidden
    const versions = collection.versions
    rows.push({
      kind: 'collection',
      slug: collection.slug,
      access: rules,
      graphQL: hasGraphQLDisabled(collection) ? 'off' : 'on',
      hidden: typeof hidden === 'function' ? 'fn' : hidden ? 'yes' : 'no',
      versions: versions ? (versions.drafts ? 'drafts' : 'versions') : 'no',
      auth: Boolean(collection.auth),
      upload: Boolean(collection.upload),
    })
  }

  for (const global of config.globals) {
    const access = (global.access ?? {}) as Record<string, unknown>
    const rules: Record<string, AccessRule> = {}
    for (const op of ['read', 'update'] as const) rules[op] = describeRule(access[op], op, true)
    if (global.versions) rules.readVersions = describeRule(access.readVersions, 'readVersions', true)
    const hidden = global.admin?.hidden
    rows.push({
      kind: 'global',
      slug: global.slug,
      access: rules,
      graphQL: hasGraphQLDisabled(global) ? 'off' : 'on',
      hidden: typeof hidden === 'function' ? 'fn' : hidden ? 'yes' : 'no',
      versions: global.versions ? (global.versions.drafts ? 'drafts' : 'versions') : 'no',
      auth: false,
      upload: false,
    })
  }

  return rows
}

const walkFields = (entity: string, fields: Field[], prefix: string, out: FieldInventory[]) => {
  for (const field of fields) {
    const name = 'name' in field && field.name ? field.name : undefined
    const here = name ? (prefix ? `${prefix}.${name}` : name) : prefix
    const access = 'access' in field && field.access ? field.access : undefined
    const hidden = 'hidden' in field && field.hidden === true
    if (name && (access || hidden)) {
      out.push({
        entity,
        path: here,
        type: field.type,
        access: access ? Object.keys(access).filter((key) => (access as Record<string, unknown>)[key]) : [],
        hidden,
      })
    }
    if ('fields' in field && Array.isArray(field.fields)) walkFields(entity, field.fields, here, out)
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const tabName = 'name' in tab && tab.name ? (here ? `${here}.${tab.name}` : tab.name) : here
        walkFields(entity, tab.fields, tabName, out)
      }
    }
    if (field.type === 'blocks') {
      for (const block of field.blocks) walkFields(entity, block.fields, `${here}<${block.slug}>`, out)
    }
  }
}

export const inventoryFields = (config: SanitizedConfig): FieldInventory[] => {
  const out: FieldInventory[] = []
  for (const collection of config.collections) walkFields(collection.slug, collection.fields, '', out)
  for (const global of config.globals) walkFields(`global:${global.slug}`, global.fields, '', out)
  return out
}

/** Файли вихідного коду `src` (без згенерованих і службових каталогів). */
const walkSource = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['assets', 'fonts', 'node_modules', '(payload)', '(frontend)'].includes(entry.name)) continue
      walkSource(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'payload-types.ts') out.push(full)
  }
  return out
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

export const sourceFiles = () => walkSource(SRC)

type AnyEndpoint = { method: string; path: string; handler: unknown }

const isEndpoint = (value: unknown): value is AnyEndpoint =>
  Boolean(value) && typeof value === 'object' && typeof (value as AnyEndpoint).handler === 'function' && typeof (value as AnyEndpoint).path === 'string'

/** Експортовані ендпоінти з `src` (обробник -> файл): ендпоінт зіставляється з файлом за ідентичністю, а не за текстом. */
const endpointModules = import.meta.glob<Record<string, unknown>>(['/src/collections/**/endpoints/*.ts', '/src/endpoints/**/*.ts'])

export const loadEndpointFiles = async (): Promise<Map<unknown, string>> => {
  const map = new Map<unknown, string>()
  for (const [file, load] of Object.entries(endpointModules)) {
    const mod = await load()
    for (const exported of Object.values(mod)) {
      const list = Array.isArray(exported) ? exported : [exported]
      for (const item of list) if (isEndpoint(item)) map.set(item.handler, file.replace(/^\//, ''))
    }
  }
  return map
}

/** Обробники, які Payload додає сам: беремо їх із мінімального конфігу з auth, upload і глобалом. */
const builtInHandlers = async (): Promise<Set<unknown>> => {
  const { buildConfig } = await import('payload')
  const { mongooseAdapter } = await import('@payloadcms/db-mongodb')
  const probe = await buildConfig({
    secret: 'audit-probe',
    db: mongooseAdapter({ url: 'mongodb://127.0.0.1:1/probe' }),
    collections: [
      { slug: 'probe-auth', auth: true, fields: [] },
      { slug: 'probe-upload', upload: true, fields: [] },
      { slug: 'probe-plain', fields: [] },
    ],
    globals: [{ slug: 'probe-global', fields: [] }],
  })
  const set = new Set<unknown>()
  for (const e of probe.endpoints ?? []) set.add(e.handler)
  for (const c of probe.collections) for (const e of c.endpoints || []) set.add(e.handler)
  for (const g of probe.globals) for (const e of g.endpoints || []) set.add(e.handler)
  return set
}

export type EndpointKind = 'custom' | 'builtin' | 'plugin'

export type EndpointInventory = {
  scope: string
  method: string
  path: string
  /** Повний шлях REST, без `/api`. */
  url: string
  file: string
  kind: EndpointKind
}

export const inventoryEndpoints = async (config: SanitizedConfig): Promise<EndpointInventory[]> => {
  const files = await loadEndpointFiles()
  const builtIn = await builtInHandlers()
  const rows: EndpointInventory[] = []

  const add = (scope: string, prefix: string, endpoints: unknown) => {
    if (!Array.isArray(endpoints)) return
    for (const endpoint of endpoints as AnyEndpoint[]) {
      const file = files.get(endpoint.handler)
      const kind: EndpointKind = file ? 'custom' : builtIn.has(endpoint.handler) ? 'builtin' : 'plugin'
      rows.push({
        scope,
        method: endpoint.method.toUpperCase(),
        path: endpoint.path,
        url: `${prefix}${endpoint.path === '/' ? '' : endpoint.path}`,
        file: file ?? (kind === 'builtin' ? 'payload (вбудований)' : 'плагін (поза src)'),
        kind,
      })
    }
  }

  add('root', '', config.endpoints)
  for (const collection of config.collections) add(collection.slug, `/${collection.slug}`, collection.endpoints)
  for (const global of config.globals) add(`global:${global.slug}`, `/globals/${global.slug}`, global.endpoints)
  return rows
}

// ---------------------------------------------------------------------------
// Local API у файлах ендпоінтів і сервісах (п. 1d)
// ---------------------------------------------------------------------------

export type LocalApiCall = {
  file: string
  line: number
  op: string
  collection: string
  overrideAccess: 'false' | 'true' | 'default' | 'змінна'
  user: boolean
  req: boolean
  source: string
}

const OPS = ['find', 'findByID', 'create', 'update', 'delete', 'count', 'findVersions', 'findVersionByID', 'restoreVersion', 'findGlobal', 'updateGlobal', 'login', 'forgotPassword', 'resetPassword', 'verifyEmail', 'duplicate', 'findDistinct']

/** Повертає текст аргументу виклику від першої `(` до парної `)`. */
const balanced = (text: string, openIndex: number): string => {
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  return text.slice(openIndex + 1)
}

const IMPORT_RE = /(?:from|import\()\s*['"]([^'"]+)['"]/g

const resolveImport = (from: string, spec: string): string | null => {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Файли обробників ендпоінтів і все, що вони транзитивно імпортують усередині `src` (без компонентів і i18n). */
export const endpointClosure = (entryFiles: string[]): string[] => {
  const seen = new Set<string>()
  const queue = entryFiles.map((file) => path.resolve(ROOT, file))
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file) || !fs.existsSync(file)) continue
    seen.add(file)
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, match[1])
      if (!target) continue
      const r = rel(target)
      if (/payload-types|\/components\/|\/i18n\/|email-templates|\/assets\//.test(r)) continue
      queue.push(target)
    }
  }
  return [...seen].map(rel).sort()
}

const argSource = (args: string): string => {
  const whereMatch = /where\s*:\s*([^,}\n]+(?:\{[^}]*\})?)/.exec(args)
  const dataMatch = /data\s*:\s*([^,}\n]+)/.exec(args)
  const parts: string[] = []
  if (whereMatch) parts.push(`where: ${whereMatch[1].trim().slice(0, 60)}`)
  if (dataMatch) parts.push(`data: ${dataMatch[1].trim().slice(0, 40)}`)
  return parts.join('; ')
}

export const scanLocalApi = (files: string[]): LocalApiCall[] => {
  const calls: LocalApiCall[] = []
  const re = new RegExp(`\\b(?:payload|req\\.payload|this\\.payload)\\.(${OPS.join('|')})\\s*(?:<[^>(]*>)?\\(`, 'g')
  for (const file of files) {
    const abs = path.resolve(ROOT, file)
    const text = fs.readFileSync(abs, 'utf8')
    for (const match of text.matchAll(re)) {
      const open = (match.index ?? 0) + match[0].length - 1
      const args = balanced(text, open)
      const line = text.slice(0, match.index).split('\n').length
      const collection = /collection\s*:\s*['"]([\w-]+)['"]/.exec(args)?.[1] ?? /slug\s*:\s*['"]([\w-]+)['"]/.exec(args)?.[1] ?? '(змінна)'
      const override = /overrideAccess\s*:\s*([\w.!]+)/.exec(args)?.[1]
      calls.push({
        file,
        line,
        op: match[1],
        collection,
        overrideAccess: override === undefined ? 'default' : override === 'false' ? 'false' : override === 'true' ? 'true' : 'змінна',
        user: /\buser\b\s*[:,}]/.test(args) && /\buser\s*(:|,|\})/.test(args),
        req: /\breq\b\s*[:,}]|\breq\s*$/.test(args) || /\breq[,\s}]/.test(args),
        source: argSource(args),
      })
    }
  }
  return calls
}

/** Рядок markdown-таблиці з екрануванням `|`. */
export const mdRow = (cells: Array<string | number>) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`
