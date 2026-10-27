import type { TFunction } from '@payloadcms/translations'

import type { CustomTranslationsKeys } from '@/i18n'
import { formatMDL } from '@/utilities/money'
import { ACCOUNTING_TIME_ZONE } from '@/utilities/period'

import type { CustomerStatement, StatementKind, StatementLine, StatementOrder } from './customerStatement.service'

/**
 * Виписка по клієнту як самодостатній HTML-файл (розд. 6.5): одна таблиця з сальдо на початок,
 * рухами й сальдо на кінець; під рядком нарахування замовлення його позиції й стан оплати.
 * Стилі вбудовані, зовнішніх ресурсів немає, файл друкується з браузера. Мова = мова адмінки (`t`).
 */

type T = TFunction<CustomTranslationsKeys>

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: ACCOUNTING_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })

const dayTime = (date: Date) =>
  date.toLocaleString('ru-RU', { timeZone: ACCOUNTING_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const periodDay = (value: string) => value.split('-').reverse().join('.')

/** Сума в комірці; нуль у колонках руху лишаємо порожнім, щоб таблиця читалася. */
const money = (bani: number, { blankZero = false } = {}) =>
  blankZero && bani === 0 ? '' : `<span class="${bani < 0 ? 'neg' : ''}">${formatMDL(bani)}</span>`

const KIND_KEYS: Record<StatementKind, CustomTranslationsKeys> = {
  order: 'custom:statement:kindOrder',
  orderCancel: 'custom:statement:kindOrderCancel',
  openingDebt: 'custom:statement:kindOpeningDebt',
  openingDebtReversal: 'custom:statement:kindOpeningDebtReversal',
  receipt: 'custom:statement:kindReceipt',
  receiptReversal: 'custom:statement:kindReceiptReversal',
  refund: 'custom:statement:kindRefund',
  refundReversal: 'custom:statement:kindRefundReversal',
  openingAdvance: 'custom:statement:kindOpeningAdvance',
  openingAdvanceReversal: 'custom:statement:kindOpeningAdvanceReversal',
}

const describe = (t: T, line: StatementLine) => {
  const order = line.orderNumber ?? ''
  if (line.kind === 'receipt' && line.orderNumber) return t('custom:statement:kindReceiptOrder', { order })

  return t(KIND_KEYS[line.kind], { order })
}

/** Рядки деталізації замовлення: його позиції. */
const orderDetails = (t: T, order: StatementOrder) =>
  order.items
    .map((item, index) => {
      const article = item.article ? ` <span class="muted">(${escape(t('custom:statement:article', { article: item.article }))})</span>` : ''
      const amount = `${item.quantity} × ${formatMDL(item.priceBani)} = ${formatMDL(item.amountBani)}`
      const last = index === order.items.length - 1 ? ' detail-last' : ''

      return `<tr class="detail${last}"><td></td><td>${escape(item.title)}${article}</td><td colspan="3" class="detail-amount">${escape(amount)}</td></tr>`
    })
    .join('\n')

const STYLE = `
  :root { color-scheme: light; }
  body { font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2328; margin: 32px auto; max-width: 960px; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 12px; text-align: center; }
  dl.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 20px; }
  dl.meta dt { color: #59636e; }
  dl.meta dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; text-align: left; vertical-align: top; }
  thead th { background: #eef2f6; border-bottom: 1px solid #c8d1db; font-weight: 600; }
  tbody tr.line td { border-top: 1px solid #e3e8ee; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.detail td { font-size: 12.5px; color: #3d444d; padding-top: 1px; padding-bottom: 1px; }
  tr.detail td:nth-child(2) { padding-left: 24px; }
  tr.detail-last td { padding-bottom: 6px; }
  td.detail-amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 600; border-top: 2px solid #c8d1db; }
  tr.edge td { font-weight: 600; background: #f6f8fa; }
  .neg { color: #b42318; }
  .muted { color: #6e7781; }
  .empty { font-style: italic; color: #6e7781; }
  @media print { body { margin: 0; max-width: none; } thead { display: table-header-group; } tr { break-inside: avoid; } }
`

export const buildStatementHtml = (statement: CustomerStatement, t: T, generatedAt = new Date()): string => {
  const { customer } = statement
  const who = [customer.name, customer.email].filter(Boolean).join(', ') || customer.id
  const title = `${t('custom:statement:title')}: ${customer.name ?? customer.email ?? customer.id}`

  const rows = statement.lines.flatMap((line) => {
    const row = `<tr class="line">
      <td>${day(line.date)}</td>
      <td>${escape(describe(t, line))}</td>
      <td class="num">${money(line.chargedBani, { blankZero: true })}</td>
      <td class="num">${money(line.paidBani, { blankZero: true })}</td>
      <td class="num">${money(line.balanceBani)}</td>
    </tr>`
    const order = (line.kind === 'order' || line.kind === 'openingDebt') && line.orderId ? statement.orders[line.orderId] : undefined

    return order ? [row, orderDetails(t, order)] : [row]
  })

  const meta = [
    [t('custom:statement:customer'), who],
    ...(customer.phone ? [[t('custom:statement:phone'), customer.phone]] : []),
    [t('custom:statement:period'), `${periodDay(statement.from)} — ${periodDay(statement.to)}`],
    [t('custom:statement:generated'), dayTime(generatedAt)],
  ]

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escape(t('custom:statement:title'))}</h1>
<dl class="meta">
${meta.map(([term, value]) => `  <dt>${escape(term)}</dt><dd>${escape(value)}</dd>`).join('\n')}
</dl>
<table>
<thead>
  <tr>
    <th>${escape(t('custom:statement:colDate'))}</th>
    <th>${escape(t('custom:statement:colDescription'))}</th>
    <th class="num">${escape(t('custom:statement:colCharged'))}</th>
    <th class="num">${escape(t('custom:statement:colPaid'))}</th>
    <th class="num">${escape(t('custom:statement:colBalance'))}</th>
  </tr>
</thead>
<tbody>
  <tr class="edge"><td></td><td>${escape(t('custom:statement:opening'))}</td><td></td><td></td><td class="num">${money(statement.openingBani)}</td></tr>
${rows.length > 0 ? rows.join('\n') : `  <tr><td></td><td colspan="4" class="empty">${escape(t('custom:statement:noMoves'))}</td></tr>`}
  <tr class="total"><td></td><td>${escape(t('custom:statement:totalPeriod'))}</td><td class="num">${money(statement.chargedBani)}</td><td class="num">${money(statement.paidBani)}</td><td></td></tr>
  <tr class="edge"><td></td><td>${escape(t('custom:statement:closing'))}</td><td></td><td></td><td class="num">${money(statement.closingBani)}</td></tr>
</tbody>
</table>
</body>
</html>
`
}
