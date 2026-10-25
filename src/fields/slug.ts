import { slugField } from 'payload'

import { label } from '@/i18n'

type SlugFieldArgs = NonNullable<Parameters<typeof slugField>[0]>

/** `slugField` з міткою зі словника: Payload сам виводить її з `name` англійською для всіх мов. */
export const localizedSlugField = (args: Omit<SlugFieldArgs, 'overrides'> = {}) =>
  slugField({
    ...args,
    overrides: (field) => {
      const slug = field.fields.find((child) => 'name' in child && child.name === (args.name ?? 'slug'))
      if (slug) (slug as { label?: unknown }).label = label('custom:field:slug')

      return field
    },
  })
