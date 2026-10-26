'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FieldDescription, FieldError, FieldLabel, fieldBaseClass, useField } from '@payloadcms/ui'
import type { NumberFieldClientComponent } from 'payload'

import { formatMDL, formatMDLRounded, toBani } from '@/utilities/money'

/** Показуємо MDL з двома знаками без розділювача розрядів (кому), щоб значення можна було редагувати. */
const toInputText = (bani: unknown, fractional = false): string => {
  if (typeof bani !== 'number' || !Number.isFinite(bani)) return ''
  if (fractional) return formatMDLRounded(bani).replace(/,/g, '')

  return Number.isInteger(bani) ? formatMDL(bani).replace(/,/g, '') : ''
}

/** Ввід у MDL з двома знаками, у формі й БД лежать цілі бані. */
export const MoneyField: NumberFieldClientComponent = (props) => {
  const { field, path: pathFromProps, readOnly, validate } = props
  const { admin: { className, description, placeholder } = {}, label, localized, required } = field

  const memoizedValidate = useCallback(
    (value: unknown, options: object) =>
      typeof validate === 'function'
        ? validate(value as number, { ...options, min: field.min, max: field.max, required } as never)
        : true,
    [validate, field.min, field.max, required],
  )

  const { disabled, path, setValue, showError, value } = useField<number>({
    potentiallyStalePath: pathFromProps,
    validate: memoizedValidate,
  })

  const fractional = field.admin?.custom?.fractional === true
  const [text, setText] = useState(() => toInputText(value, fractional))
  const focused = useRef(false)

  // Значення змінилося ззовні (завантаження документа, скидання форми).
  useEffect(() => {
    if (!focused.current) setText(toInputText(value, fractional))
  }, [value, fractional])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    setText(next)

    if (next.trim() === '') {
      setValue(null)
      return
    }

    try {
      setValue(toBani(next))
    } catch {
      // Недописане число ("-", "12,"): лишаємо попереднє значення до наступного символу.
    }
  }

  const handleBlur = () => {
    focused.current = false
    setText(toInputText(value, fractional))
  }

  const isReadOnly = Boolean(readOnly || disabled)

  return (
    <div
      className={[fieldBaseClass, 'number', className, showError && 'error', isReadOnly && 'read-only']
        .filter(Boolean)
        .join(' ')}
    >
      <FieldLabel label={label} localized={localized} path={path} required={required} />
      <div className={`${fieldBaseClass}__wrap`}>
        <FieldError path={path} showError={showError} />
        <input
          disabled={isReadOnly}
          id={`field-${path.replace(/\./g, '__')}`}
          inputMode="decimal"
          name={path}
          onBlur={handleBlur}
          onChange={handleChange}
          onFocus={() => {
            focused.current = true
          }}
          placeholder={typeof placeholder === 'string' ? placeholder : '0.00'}
          type="text"
          value={text}
        />
        <FieldDescription description={description} path={path} />
      </div>
    </div>
  )
}
