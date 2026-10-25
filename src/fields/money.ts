import type { NumberField, Validate } from 'payload'
import { number } from 'payload/shared'

import { customT } from '@/i18n/labels'

type BaniValidate = Validate<number, unknown, unknown, NumberField>

/** Сума в цілих банях: ціле число плюс стандартні required/min/max поля `number`. */
export const validateBani: BaniValidate = (value, options) => {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return customT(options.req.t)('custom:validation:wholeBani')
  }

  return number(value, options)
}

/** Сума не нульова: для рядків зі знаком, де нуль безглуздий (наприклад, борг або аванс). */
const validateNonZeroBani: BaniValidate = (value, options) =>
  value === 0 ? customT(options.req.t)('custom:validation:nonZeroBani') : validateBani(value, options)

type MoneyFieldOptions = Omit<NumberField, 'type' | 'hasMany' | 'maxRows' | 'minRows' | 'validate'> & {
  name: string
  /** Забороняє нуль; знак суми довільний. */
  nonZero?: boolean
}

/**
 * Поле грошей: у БД цілі бані, в адмінці ввід і показ у MDL з двома знаками.
 * Першим використанням треба перегенерувати importMap (`pnpm generate:importmap`).
 */
export const moneyField = ({ nonZero, ...options }: MoneyFieldOptions): NumberField => ({
  ...options,
  type: 'number',
  validate: nonZero ? validateNonZeroBani : validateBani,
  admin: {
    ...options.admin,
    components: {
      ...options.admin?.components,
      Field: '@/components/MoneyField/Field#MoneyField',
      Cell: '@/components/MoneyField/Cell#MoneyCell',
    },
  },
})
