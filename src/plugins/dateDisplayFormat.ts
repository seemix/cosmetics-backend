import type { Field, Plugin } from 'payload'

/** Формат дат в адмінці: 22.11.2016; для полів з часом — 22.11.2016 14:05. */
export const DATE_FORMAT = 'dd.MM.yyyy'
export const DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'

type DateField = Extract<Field, { type: 'date' }>

const withDisplayFormat = (field: DateField): DateField => {
  const date = field.admin?.date
  if (date?.displayFormat) return field

  const appearance = date?.pickerAppearance ?? 'default'
  if (appearance === 'timeOnly' || appearance === 'monthOnly') return field

  return {
    ...field,
    admin: {
      ...field.admin,
      date: {
        ...date,
        displayFormat: appearance === 'dayAndTime' ? DATE_TIME_FORMAT : DATE_FORMAT,
        ...(appearance === 'dayAndTime' ? { timeFormat: (date as { timeFormat?: string } | undefined)?.timeFormat ?? 'HH:mm' } : {}),
      },
    },
  } as DateField
}

const mapFields = (fields: Field[]): Field[] =>
  fields.map((field) => {
    if (field.type === 'date') return withDisplayFormat(field)
    if (field.type === 'tabs') return { ...field, tabs: field.tabs.map((tab) => ({ ...tab, fields: mapFields(tab.fields) })) }
    if (field.type === 'blocks') {
      return { ...field, blocks: field.blocks.map((block) => (typeof block === 'string' ? block : { ...block, fields: mapFields(block.fields) })) }
    }
    if ('fields' in field && Array.isArray(field.fields)) return { ...field, fields: mapFields(field.fields) } as Field

    return field
  })

/**
 * Єдиний формат дат в адмінці. Клітинки `createdAt`/`updatedAt` і мета документа беруть `admin.dateFormat`,
 * а поля типу `date` (і в клітинці, і в полі вводу) — `admin.date.displayFormat`, тож ставимо його всім полям,
 * де формат не задано явно. Плагін має стояти після плагінів, що додають колекції.
 */
export const dateDisplayFormat: Plugin = (config) => ({
  ...config,
  admin: { ...config.admin, dateFormat: config.admin?.dateFormat ?? DATE_FORMAT },
  collections: (config.collections ?? []).map((collection) => ({ ...collection, fields: mapFields(collection.fields) })),
  globals: (config.globals ?? []).map((global) => ({ ...global, fields: mapFields(global.fields) })),
})
