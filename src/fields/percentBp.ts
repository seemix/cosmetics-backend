import type { NumberField, Validate } from 'payload'
import { number } from 'payload/shared'

import { customT } from '@/i18n/labels'
import { MAX_PERCENT_BP } from '@/utilities/percent'

type PercentBpValidate = Validate<number, unknown, unknown, NumberField>

/** Відсоток у базисних пунктах: ціле 0..10000 плюс стандартний `required`. */
export const validatePercentBp: PercentBpValidate = (value, options) => {
  if (typeof value === 'number' && (!Number.isInteger(value) || value < 0 || value > MAX_PERCENT_BP)) {
    return customT(options.req.t)('custom:validation:percentBp')
  }

  return number(value, options)
}

type PercentBpFieldOptions = Omit<NumberField, 'type' | 'hasMany' | 'maxRows' | 'minRows' | 'validate' | 'min' | 'max'> & {
  name: string
}

/**
 * Поле відсотка: у БД цілі базисні пункти (12,35 % = 1235), в адмінці ввід і показ у відсотках
 * з двома знаками. Першим використанням треба перегенерувати importMap (`pnpm generate:importmap`).
 */
export const percentBpField = (options: PercentBpFieldOptions): NumberField => ({
  ...options,
  type: 'number',
  min: 0,
  max: MAX_PERCENT_BP,
  validate: validatePercentBp,
  admin: {
    ...options.admin,
    components: {
      ...options.admin?.components,
      Field: '@/components/PercentBpField/Field#PercentBpField',
      Cell: '@/components/PercentBpField/Cell#PercentBpCell',
    },
  },
})
