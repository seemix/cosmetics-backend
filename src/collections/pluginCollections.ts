import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Access, Field } from 'payload'

import { adminOnly } from '@/access/adminOnly'

import { description, label, localized, type CustomTranslationsKeys } from '@/i18n'

type Texts = {
  labels?: Record<string, CustomTranslationsKeys>
  descriptions?: Record<string, CustomTranslationsKeys>
}

/** Підставляє переклади в поля плагіна за `name`, зокрема у вкладених `group`, `row`, `array`, `tabs`. */
const translateFields = (fields: Field[], texts: Texts): Field[] =>
  fields.map((field) => {
    const next = { ...field } as Field & { fields?: Field[]; tabs?: { fields: Field[] }[] }
    const name = ('name' in next && next.name) || next.type

    if (name && texts.labels?.[name]) (next as { label?: unknown }).label = label(texts.labels[name])
    if (name && texts.descriptions?.[name]) {
      next.admin = { ...next.admin, description: description(texts.descriptions[name]) }
    }
    if (next.fields) next.fields = translateFields(next.fields, texts)
    if (next.tabs) next.tabs = next.tabs.map((tab) => ({ ...tab, fields: translateFields(tab.fields, texts) }))

    return next as Field
  })

const override =
  (texts: Texts, access: { readVersions?: Access } = {}): CollectionOverride =>
  ({ defaultCollection }) => ({
    ...defaultCollection,
    access: { ...defaultCollection.access, ...access },
    // Група, як і раніше, лише там, де її задає плагін (це завжди `Ecommerce`).
    admin: {
      ...defaultCollection.admin,
      ...(defaultCollection.admin?.group ? { group: localized('custom:group:ecommerce') } : {}),
    },
    fields: translateFields(defaultCollection.fields, texts),
  })

/** Колекції плагіна ecommerce, які не мають власного файлу в `src/collections`. */
export const VariantsCollection = override(
  {
    labels: { title: 'custom:field:title', product: 'custom:term:product', options: 'custom:field:variantOptions' },
    descriptions: { title: 'custom:desc:adminOnlyTitle', group: 'custom:desc:pricesByCurrency' },
  },
  { readVersions: adminOnly },
)

export const VariantTypesCollection = override({
  labels: { label: 'custom:field:label', name: 'custom:term:name', options: 'custom:field:options' },
})

export const VariantOptionsCollection = override({
  labels: { variantType: 'custom:field:variantType', label: 'custom:field:label', value: 'custom:field:value' },
  descriptions: { value: 'custom:desc:valueFromLabel' },
})

export const TransactionsCollection = override({
  labels: { cart: 'custom:field:cart' },
})
