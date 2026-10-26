'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'

import type { CustomTranslationsKeys } from '@/i18n'
import type { DebtsReport } from '@/services/reports/debts.service'
import type { ExpensesReport } from '@/services/reports/expenses.service'
import type { ProfitReport } from '@/services/reports/profit.service'
import type { PurchasesReport } from '@/services/reports/purchases.service'
import type { SalaryReport } from '@/services/reports/salary.service'
import type { StockReport } from '@/services/reports/stock.service'

import { canRetry, errorKey, fieldErrorKeys, type ReportError } from './lib/errors'
import { buildReportUrl, parseState, serializeState, TABS, validateState, type ReportTab, type ViewState } from './lib/urlState'
import { Filters } from './parts/Filters'
import { ReportsProvider, useReports, WarningBanner, type ReportsContextValue } from './parts/Ui'
import { DebtsTab } from './tabs/Debts'
import { ExpensesTab } from './tabs/Expenses'
import { ProfitTab } from './tabs/Profit'
import { PurchasesTab } from './tabs/Purchases'
import { SalaryTab } from './tabs/Salary'
import { StockTab } from './tabs/Stock'
import './styles.css'

const TAB_LABELS: Record<ReportTab, CustomTranslationsKeys> = {
  profit: 'custom:reports:tabProfit',
  stock: 'custom:reports:tabStock',
  purchases: 'custom:reports:tabPurchases',
  expenses: 'custom:reports:tabExpenses',
  debts: 'custom:reports:tabDebts',
  salary: 'custom:reports:tabSalary',
}

type ReportData = ProfitReport | StockReport | PurchasesReport | ExpensesReport | DebtsReport | SalaryReport

type Result = { url: string; data?: ReportData; error?: ReportError }

/** Запит до R1; відповідь застарілого запиту (інші фільтри, інша вкладка) не потрапляє в стан. */
const useReport = (url: string | null, attempt: number) => {
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!url) return

    const controller = new AbortController()

    fetch(url, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          code?: string
          fields?: ReportError['fields']
        }

        setResult(
          response.ok
            ? { url, data: body as unknown as ReportData }
            : { url, error: { status: response.status, code: body.code, fields: body.fields } },
        )
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setResult({ url, error: { status: 0 } })
      })

    return () => controller.abort()
  }, [url, attempt])

  // Результат іншого URL ще не відповідь на поточний запит.
  return url && result?.url === url ? result : null
}

const ErrorBox = ({ error, onRetry }: { error: ReportError; onRetry: () => void }) => {
  const { t } = useReports()
  const fields = (error.fields ?? []).map((item) => {
    const keys = fieldErrorKeys(item)
    const field = keys.field ? t(keys.field) : item.field

    return keys.reason ? `${field} (${t(keys.reason)})` : field
  })

  return (
    <div className="reports__error" role="alert">
      <p>{t(errorKey(error), { fields: fields.join(', '), days: '400' })}</p>
      {canRetry(error) && (
        <button type="button" className="reports__btn" onClick={onRetry}>
          {t('custom:reports:retry')}
        </button>
      )}
    </div>
  )
}

const Report = ({ state, data, onPage }: { state: ViewState; data: ReportData; onPage: (page: number) => void }) => {
  switch (state.tab) {
    case 'profit':
      return <ProfitTab data={data as ProfitReport} />
    case 'stock':
      return <StockTab data={data as StockReport} onPage={onPage} />
    case 'purchases':
      return <PurchasesTab data={data as PurchasesReport} onPage={onPage} />
    case 'expenses':
      return <ExpensesTab data={data as ExpensesReport} onPage={onPage} />
    case 'debts':
      return <DebtsTab data={data as DebtsReport} onPage={onPage} />
    case 'salary':
      return <SalaryTab data={data as SalaryReport} />
  }
}

const Reports = () => {
  const { t, timeZone, apiRoute } = useReports()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [attempt, setAttempt] = useState(0)

  const query = searchParams.toString()
  const state = useMemo(() => parseState(new URLSearchParams(query), new Date(), timeZone), [query, timeZone])

  const update = useCallback(
    (patch: Partial<ViewState>) => {
      // Будь-яка зміна, крім самої сторінки, повертає на першу.
      const next: ViewState = { ...state, page: 1, ...patch }
      router.replace(`${pathname}?${serializeState(next)}`, { scroll: false })
    },
    [state, router, pathname],
  )

  const setPage = useCallback(
    (page: number) => router.replace(`${pathname}?${serializeState({ ...state, page })}`, { scroll: false }),
    [state, router, pathname],
  )

  const periodError = validateState(state)
  const url = periodError ? null : buildReportUrl(state, apiRoute)
  const result = useReport(url, attempt)
  const loading = Boolean(url) && !result

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const shift = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!shift) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(state.tab) + shift + TABS.length) % TABS.length]
    update({ tab: next })
    requestAnimationFrame(() => document.getElementById(`reports-tab-${next}`)?.focus())
  }

  const warnings = result?.data && 'warnings' in result.data ? result.data.warnings : []

  return (
    <div className="reports">
      <h1 className="reports__title">{t('custom:reports:title')}</h1>

      <div className="reports__tabs" role="tablist" aria-label={t('custom:reports:tabsLabel')}>
        {TABS.map((tab) => (
          <button
            key={tab}
            id={`reports-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={state.tab === tab}
            aria-controls="reports-panel"
            tabIndex={state.tab === tab ? 0 : -1}
            className="reports__tab"
            onClick={() => update({ tab })}
            onKeyDown={onTabKey}
          >
            {t(TAB_LABELS[tab])}
          </button>
        ))}
      </div>

      <div id="reports-panel" role="tabpanel" aria-labelledby={`reports-tab-${state.tab}`} aria-busy={loading}>
        <Filters state={state} periodError={periodError} onChange={update} />
        <p className="reports__muted">{t('custom:reports:amountsNote')}</p>

        {loading && <p role="status">{t('custom:reports:loading')}</p>}
        {result?.error && <ErrorBox error={result.error} onRetry={() => setAttempt((value) => value + 1)} />}
        {result?.data && (
          <>
            <WarningBanner warnings={warnings} />
            <Report state={state} data={result.data} onPage={setPage} />
          </>
        )}
      </div>
    </div>
  )
}

export const ReportsView = (props: ReportsContextValue) => (
  <ReportsProvider value={props}>
    <Reports />
  </ReportsProvider>
)
