import { isDay, presetRange, validatePeriod, type PeriodError } from './periods'

/**
 * Стан сторінки звітів у URL (`searchParams`): вкладка, дати, фільтри, сторінка. Невалідні значення
 * мовчки замінюються типовими; зрозумілі, але недопустимі пари дат (from > to, понад 400 днів)
 * лишаються й показуються повідомленням, запит у такому разі не надсилається.
 */

export const TABS = ['profit', 'stock', 'purchases', 'expenses', 'debts', 'salary'] as const
export type ReportTab = (typeof TABS)[number]

export type ViewState = {
  tab: ReportTab
  from: string
  to: string
  asOf: string
  warehouse: string
  q: string
  supplier: string
  category: string
  account: string
  manager: string
  page: number
}

const OBJECT_ID = /^[0-9a-fA-F]{24}$/
const MAX_QUERY_LENGTH = 100
const MAX_PAGE = 1_000_000

const PERIOD_TABS: readonly ReportTab[] = ['profit', 'purchases', 'expenses', 'salary']

export const usesPeriod = (tab: ReportTab) => PERIOD_TABS.includes(tab)

/** Які параметри (крім вкладки) стосуються вкладки: ті самі йдуть і в URL сторінки, і в запит до R1. */
const TAB_PARAMS: Record<ReportTab, ReadonlyArray<Exclude<keyof ViewState, 'tab'>>> = {
  profit: ['from', 'to'],
  stock: ['warehouse', 'q', 'page'],
  purchases: ['from', 'to', 'supplier', 'page'],
  expenses: ['from', 'to', 'category', 'account', 'page'],
  debts: ['asOf', 'page'],
  salary: ['from', 'to', 'manager'],
}

export const defaultState = (now: Date, timeZone: string): ViewState => ({
  tab: 'profit',
  ...presetRange('thisMonth', now, timeZone),
  asOf: '',
  warehouse: '',
  q: '',
  supplier: '',
  category: '',
  account: '',
  manager: '',
  page: 1,
})

type ParamSource = { get(name: string): string | null }

export const parseState = (source: ParamSource, now: Date, timeZone: string): ViewState => {
  const state = defaultState(now, timeZone)
  const read = (name: string) => source.get(name)?.trim() ?? ''

  const tab = read('tab')
  if ((TABS as readonly string[]).includes(tab)) state.tab = tab as ReportTab

  const from = read('from')
  const to = read('to')
  if (isDay(from)) state.from = from
  if (isDay(to)) state.to = to

  const asOf = read('asOf')
  if (isDay(asOf)) state.asOf = asOf

  for (const name of ['warehouse', 'supplier', 'category', 'account', 'manager'] as const) {
    const value = read(name)
    if (OBJECT_ID.test(value)) state[name] = value
  }

  const q = read('q')
  if (q.length > 0 && q.length <= MAX_QUERY_LENGTH) state.q = q

  const page = read('page')
  if (/^\d{1,7}$/.test(page) && Number(page) >= 1 && Number(page) <= MAX_PAGE) state.page = Number(page)

  return state
}

/** Параметри вкладки без порожніх і типових значень (`page=1`). */
const paramsFor = (state: ViewState): URLSearchParams => {
  const params = new URLSearchParams()

  for (const name of TAB_PARAMS[state.tab]) {
    const value = state[name]
    if (value === '' || (name === 'page' && value === 1)) continue
    params.set(name, String(value))
  }

  return params
}

/** Рядок запиту сторінки: усі непорожні поля (період і фільтри переживають зміну вкладки), `page` лише > 1. */
export const serializeState = (state: ViewState): string => {
  const params = new URLSearchParams({ tab: state.tab })

  for (const name of ['from', 'to', 'asOf', 'warehouse', 'q', 'supplier', 'category', 'account', 'manager'] as const) {
    if (state[name]) params.set(name, state[name])
  }
  if (state.page > 1) params.set('page', String(state.page))

  return params.toString()
}

/** URL запиту до R1: `/api/reports/<tab>?...` зі спільного набору параметрів. */
export const buildReportUrl = (state: ViewState, apiRoute: string): string => {
  const query = paramsFor(state).toString()

  return `${apiRoute}/reports/${state.tab}${query ? `?${query}` : ''}`
}

/** Клієнтська валідація, що відповідає серверу; `null`, якщо запит можна надсилати. */
export const validateState = (state: ViewState): PeriodError | null =>
  usesPeriod(state.tab) ? validatePeriod(state.from, state.to) : null
