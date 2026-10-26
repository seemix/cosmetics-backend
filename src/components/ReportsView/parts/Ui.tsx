'use client'

import Link from 'next/link'
import { createContext, useContext, type ReactNode } from 'react'
import { useTranslation } from '@payloadcms/ui'

import type { CustomTranslationsKeys } from '@/i18n'
import { customT } from '@/i18n/labels'
import type { ReportWarning } from '@/services/reports/common'
import { formatMDL } from '@/utilities/money'

import { debtMeaning, formatDate, formatInt, type DebtKind } from '../lib/format'

export type ReportsContextValue = { language: string; timeZone: string; adminRoute: string; apiRoute: string }

const ReportsContext = createContext<ReportsContextValue | null>(null)

export const ReportsProvider = ReportsContext.Provider

/** Переклад зі словника й налаштування сторінки в одному місці. */
export const useReports = () => {
  const context = useContext(ReportsContext)
  if (!context) throw new Error('useReports must be used inside ReportsProvider')
  const { t } = useTranslation()

  return { ...context, t: customT(t) }
}

/** Сума в MDL з двома знаками, праворуч, від'ємні виділені. */
export const Money = ({ bani, strong }: { bani: number; strong?: boolean }) => (
  <span className={`reports__num${bani < 0 ? ' reports__neg' : ''}${strong ? ' reports__strong' : ''}`}>
    {formatMDL(bani)}
  </span>
)

export const Count = ({ value }: { value: number }) => {
  const { language } = useReports()

  return <span className="reports__num">{formatInt(value, language)}</span>
}

export const DateText = ({ iso }: { iso: string | null | undefined }) => {
  const { language, timeZone } = useReports()

  return <>{formatDate(iso, language, timeZone)}</>
}

/** Борг із підказкою про знак; для від'ємних значень пояснення видно прямо під сумою. */
export const DebtAmount = ({ kind, bani }: { kind: DebtKind; bani: number }) => {
  const { t } = useReports()
  const meaning = t(debtMeaning(kind, bani))

  return (
    <span title={meaning}>
      <Money bani={bani} />
      {bani < 0 && <small className="reports__muted reports__block">{meaning}</small>}
    </span>
  )
}

/** Посилання на документ в адмінці; без id просто текст. */
export const DocLink = ({ collection, id, children }: { collection: string; id?: string | null; children: ReactNode }) => {
  const { adminRoute } = useReports()
  if (!id) return <>{children}</>

  const base = adminRoute === '/' ? '' : adminRoute

  return <Link href={`${base}/collections/${collection}/${id}`}>{children}</Link>
}

export const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="reports__section">
    <h3 className="reports__heading">{title}</h3>
    {hint && <p className="reports__muted">{hint}</p>}
    {children}
  </section>
)

export type SummaryRow = { label: string; bani?: number; count?: number; strong?: boolean }

export const Summary = ({ rows }: { rows: SummaryRow[] }) => (
  <dl className="reports__summary">
    {rows.map((row) => (
      <div key={row.label} className={`reports__summary-row${row.strong ? ' reports__summary-row--strong' : ''}`}>
        <dt>{row.label}</dt>
        <dd>
          {row.bani !== undefined && <Money bani={row.bani} strong={row.strong} />}
          {row.count !== undefined && <Count value={row.count} />}
        </dd>
      </div>
    ))}
  </dl>
)

export type Column<Row> = { header: string; numeric?: boolean; cell: (row: Row) => ReactNode }

/** Таблиця з `<th scope>`, підписом і горизонтальною прокруткою у вузьких вікнах. */
export const DataTable = <Row,>({
  caption,
  columns,
  rows,
  rowKey,
  footer,
}: {
  caption: string
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  footer?: ReactNode[]
}) => {
  const { t } = useReports()

  if (rows.length === 0) return <p className="reports__muted">{t('custom:reports:empty')}</p>

  return (
    <div className="reports__scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="reports__table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={column.numeric ? 'reports__right' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column, position) =>
                position === 0 ? (
                  <th key={column.header} scope="row">
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.header} className={column.numeric ? 'reports__right' : undefined}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              {footer.map((cell, position) => (
                <td key={position} className={columns[position]?.numeric ? 'reports__right' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

export const Pager = ({
  pagination,
  onPage,
}: {
  pagination: { page: number; limit: number; total: number }
  onPage: (page: number) => void
}) => {
  const { t, language } = useReports()
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.limit))
  if (pages <= 1) return null

  return (
    <nav className="reports__pager" aria-label={t('custom:reports:page')}>
      <button type="button" className="reports__btn" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>
        {t('custom:reports:prev')}
      </button>
      <span aria-live="polite">
        {t('custom:reports:pageOf', {
          page: formatInt(pagination.page, language),
          pages: formatInt(pages, language),
          total: formatInt(pagination.total, language),
        })}
      </span>
      <button type="button" className="reports__btn" disabled={pagination.page >= pages} onClick={() => onPage(pagination.page + 1)}>
        {t('custom:reports:next')}
      </button>
    </nav>
  )
}

const warningText = (warning: ReportWarning): [CustomTranslationsKeys, Record<string, string>] =>
  warning.code === 'ACCOUNTING_NOT_STARTED'
    ? ['custom:reports:warnNotStarted', {}]
    : ['custom:reports:warnBeforeStart', { date: warning.accountingStartAt }]

export const WarningBanner = ({ warnings }: { warnings: ReportWarning[] }) => {
  const { t, language, timeZone } = useReports()
  if (warnings.length === 0) return null

  return (
    <div className="reports__banner" role="status">
      {warnings.map((warning) => {
        const [key, vars] = warningText(warning)
        if (vars.date) vars.date = formatDate(vars.date, language, timeZone)

        return <p key={warning.code}>{t(key, vars)}</p>
      })}
    </div>
  )
}

const KNOWN_STATUSES: Record<string, CustomTranslationsKeys> = {
  draft: 'custom:status:draft',
  posted: 'custom:status:posted',
  reversed: 'custom:status:reversed',
}

export const StatusText = ({ status }: { status: string }) => {
  const { t } = useReports()
  const key = KNOWN_STATUSES[status]

  return <>{key ? t(key) : status}</>
}
