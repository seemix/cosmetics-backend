'use client'

import { useEffect, useId, useState } from 'react'

import { PRESETS, presetRange, type PeriodError, type PresetId } from '../lib/periods'
import { usesPeriod, type ViewState } from '../lib/urlState'
import { useReports } from './Ui'
import type { CustomTranslationsKeys } from '@/i18n'

type Option = { value: string; label: string }

const PRESET_LABELS: Record<PresetId, CustomTranslationsKeys> = {
  thisMonth: 'custom:reports:presetThisMonth',
  lastMonth: 'custom:reports:presetLastMonth',
  thisQuarter: 'custom:reports:presetThisQuarter',
  yearToDate: 'custom:reports:presetYearToDate',
}

const PERIOD_ERRORS: Record<PeriodError, CustomTranslationsKeys> = {
  required: 'custom:reports:periodRequired',
  format: 'custom:reports:periodFormat',
  order: 'custom:reports:periodOrder',
  tooLong: 'custom:reports:periodTooLong',
}

type Source = { slug: string; query: string; label: (doc: Record<string, unknown>) => string }

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const SOURCES = {
  warehouse: { slug: 'warehouses', query: 'sort=name', label: (doc) => text(doc.name) },
  supplier: { slug: 'suppliers', query: 'sort=name', label: (doc) => text(doc.name) },
  category: { slug: 'expense-categories', query: 'sort=name', label: (doc) => text(doc.name) },
  account: { slug: 'cash-accounts', query: 'sort=name', label: (doc) => text(doc.name) },
  manager: {
    slug: 'users',
    query: 'where[roles][contains]=manager',
    label: (doc) => [text(doc.name), text(doc.surname)].filter(Boolean).join(' ') || text(doc.email),
  },
} satisfies Record<string, Source>

type SelectName = keyof typeof SOURCES

/** Список значень для фільтра з REST колекції (до 200 записів), без власних ендпоінтів. */
const OptionSelect = ({
  name,
  label,
  value,
  onChange,
}: {
  name: SelectName
  label: string
  value: string
  onChange: (value: string) => void
}) => {
  const { t, apiRoute } = useReports()
  const id = useId()
  const [options, setOptions] = useState<Option[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const source: Source = SOURCES[name]

    fetch(`${apiRoute}/${source.slug}?limit=200&depth=0&${source.query}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { docs: [] }))
      .then((body: { docs?: Array<Record<string, unknown>> }) =>
        setOptions((body.docs ?? []).map((doc) => ({ value: text(doc.id), label: source.label(doc) || text(doc.id) }))),
      )
      .catch(() => undefined)

    return () => controller.abort()
  }, [name, apiRoute])

  return (
    <div className="reports__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('custom:reports:filterAll')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const DateInput = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => {
  const id = useId()

  return (
    <div className="reports__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

/** Пошук: у URL потрапляє із затримкою, щоб не слати запит на кожну літеру. */
const SearchInput = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => {
  const id = useId()
  const [draft, setDraft] = useState(value)

  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onChange(draft), 400)

    return () => clearTimeout(timer)
  }, [draft, value, onChange])

  return (
    <div className="reports__field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" maxLength={100} value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>
  )
}

export const Filters = ({
  state,
  periodError,
  onChange,
}: {
  state: ViewState
  periodError: PeriodError | null
  onChange: (patch: Partial<ViewState>) => void
}) => {
  const { t, timeZone } = useReports()
  const { tab } = state

  return (
    <div className="reports__filters">
      {usesPeriod(tab) && (
        <>
          <DateInput label={t('custom:reports:filterFrom')} value={state.from} onChange={(from) => onChange({ from })} />
          <DateInput label={t('custom:reports:filterTo')} value={state.to} onChange={(to) => onChange({ to })} />
          <div className="reports__presets" role="group" aria-label={t('custom:reports:presets')}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="reports__btn"
                onClick={() => onChange(presetRange(preset, new Date(), timeZone))}
              >
                {t(PRESET_LABELS[preset])}
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'debts' && (
        <>
          <DateInput label={t('custom:reports:filterAsOf')} value={state.asOf} onChange={(asOf) => onChange({ asOf })} />
          {state.asOf && (
            <button type="button" className="reports__btn" onClick={() => onChange({ asOf: '' })}>
              {t('custom:reports:asOfNow')}
            </button>
          )}
        </>
      )}
      {tab === 'stock' && (
        <>
          <OptionSelect name="warehouse" label={t('custom:term:warehouse')} value={state.warehouse} onChange={(warehouse) => onChange({ warehouse })} />
          <SearchInput label={t('custom:reports:filterSearch')} value={state.q} onChange={(q) => onChange({ q })} />
        </>
      )}
      {tab === 'purchases' && (
        <OptionSelect name="supplier" label={t('custom:term:supplier')} value={state.supplier} onChange={(supplier) => onChange({ supplier })} />
      )}
      {tab === 'expenses' && (
        <>
          <OptionSelect name="category" label={t('custom:reports:filterCategory')} value={state.category} onChange={(category) => onChange({ category })} />
          <OptionSelect name="account" label={t('custom:term:cashAccount')} value={state.account} onChange={(account) => onChange({ account })} />
        </>
      )}
      {tab === 'salary' && (
        <OptionSelect name="manager" label={t('custom:term:manager')} value={state.manager} onChange={(manager) => onChange({ manager })} />
      )}
      {periodError && (
        <p className="reports__error" role="alert">
          {t(PERIOD_ERRORS[periodError], { days: '400' })}
        </p>
      )}
    </div>
  )
}
