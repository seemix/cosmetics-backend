import { QueryError, type CollectionBeforeOperationHook, type Field, type PayloadRequest, type SanitizedCollectionConfig } from 'payload'

type Level = { collection: SanitizedCollectionConfig; fields: Field[] }

/** Поля, на які можна посилатись за іменем, з урахуванням контейнерів без імені (row, collapsible, tabs). */
const flatten = (fields: Field[]): Field[] =>
  fields.flatMap((field) => {
    if ('name' in field && field.name) return [field]
    if ('fields' in field && Array.isArray(field.fields)) return flatten(field.fields)
    if (field.type === 'tabs') return field.tabs.flatMap((tab) => ('name' in tab && tab.name ? [tab as unknown as Field] : flatten(tab.fields)))
    return []
  })

/** Чи може користувач читати кожне поле шляху сортування (`accounting.cogsBani`, `customer.roles`). */
const canReadPath = async (req: PayloadRequest, start: Level, path: string): Promise<boolean> => {
  let level: Level | null = start

  for (const segment of path.split('.')) {
    if (!level) return true
    const field: Field | undefined = flatten(level.fields).find((item) => 'name' in item && item.name === segment)
    if (!field) return true // службові поля (id, createdAt…) і невідомі шляхи перевіряє Payload

    const read = 'access' in field ? field.access?.read : undefined
    if (read && !(await read({ req, siblingData: {}, data: {}, doc: {}, id: undefined } as never))) return false

    if ('fields' in field && Array.isArray(field.fields)) level = { collection: level.collection, fields: field.fields }
    else if ((field.type === 'relationship' || field.type === 'upload') && typeof field.relationTo === 'string') {
      const related: SanitizedCollectionConfig | undefined = (req.payload.collections as Record<string, { config: SanitizedCollectionConfig } | undefined>)[field.relationTo]?.config
      level = related ? { collection: related, fields: related.fields } : null
    } else level = null
  }

  return true
}

/**
 * `where` за полем без права читання Payload відхиляє (QueryError), а `sort` не перевіряє: порядок
 * результатів відкриває порядок значень (собівартість, оптова ціна). Для запитів з перевіркою доступу
 * (REST, GraphQL) відхиляємо сортування за закритим полем так само, як `where`.
 */
export const guardSortFields: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'read') return args

  const { overrideAccess, sort } = args as { overrideAccess?: boolean; sort?: string | string[] }
  if (overrideAccess === true || !sort) return args

  const paths = (Array.isArray(sort) ? sort : String(sort).split(',')).map((item) => item.trim().replace(/^-/, '')).filter(Boolean)
  const config = (args as { collection: { config: SanitizedCollectionConfig } }).collection.config

  const denied: Array<{ path: string }> = []
  for (const path of paths) {
    if (!(await canReadPath(req, { collection: config, fields: config.fields }, path))) denied.push({ path })
  }
  if (denied.length) throw new QueryError(denied)

  return args
}
