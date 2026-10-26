import ExcelJS from 'exceljs'
import type { TFunction } from '@payloadcms/translations'

import type { CustomTranslationsKeys } from '@/i18n'
import { ACCOUNTING_TIME_ZONE } from '@/utilities/period'

import type { CustomerStatement, StatementKind, StatementLine } from './customerStatement.service'

/**
 * Виписка по клієнту в Excel (розд. 6.5): аркуш «Рухи» з сальдо на початок, рухами й сальдо на
 * кінець, аркуш «Замовлення» з позиціями. Суми в MDL числами з форматом `#,##0.00`, щоб у Excel
 * їх можна було рахувати; дати в поясі обліку. Мова тексту = мова адмінки (`t`).
 */

type T = TFunction<CustomTranslationsKeys>

const MONEY = '#,##0.00;[Red]-#,##0.00'
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } }
const ORDER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }
const THIN: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } }

const mdl = (bani: number) => bani / 100

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { timeZone: ACCOUNTING_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' })

const dayTime = (date: Date) =>
  date.toLocaleString('ru-RU', { timeZone: ACCOUNTING_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const periodDay = (value: string) => value.split('-').reverse().join('.')

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

const statusKey = (status: string | null): CustomTranslationsKeys | null =>
  status === 'pending' || status === 'paid' || status === 'shipped' || status === 'cancelled' ? `custom:status:${status}` : null

const paymentKey = (state: string | null): CustomTranslationsKeys | null =>
  state === 'unpaid' ? 'custom:option:paymentUnpaid' : state === 'partial' ? 'custom:option:paymentPartial' : state === 'paid' ? 'custom:option:paymentPaid' : null

const styleHeader = (row: ExcelJS.Row) => {
  row.font = { bold: true }
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.border = THIN
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
}

const money = (row: ExcelJS.Row, columns: number[]) => {
  for (const column of columns) row.getCell(column).numFmt = MONEY
}

/** Шапка аркуша: назва, клієнт, період; повертає наступний вільний рядок. */
const writeHeading = (sheet: ExcelJS.Worksheet, t: T, statement: CustomerStatement, generatedAt: Date) => {
  const { customer } = statement
  sheet.addRow([t('custom:statement:title')]).font = { bold: true, size: 14 }
  sheet.addRow([t('custom:statement:customer'), [customer.name, customer.email].filter(Boolean).join(', ') || customer.id])
  if (customer.phone) sheet.addRow([t('custom:statement:phone'), customer.phone])
  sheet.addRow([t('custom:statement:period'), `${periodDay(statement.from)} — ${periodDay(statement.to)}`])
  sheet.addRow([t('custom:statement:generated'), dayTime(generatedAt)])
  sheet.addRow([])
}

const writeMoves = (workbook: ExcelJS.Workbook, t: T, statement: CustomerStatement, generatedAt: Date) => {
  const sheet = workbook.addWorksheet(t('custom:statement:sheetMoves'))
  sheet.columns = [{ width: 12 }, { width: 16 }, { width: 44 }, { width: 15 }, { width: 15 }, { width: 15 }]
  writeHeading(sheet, t, statement, generatedAt)

  const opening = sheet.addRow(['', '', t('custom:statement:opening'), '', '', mdl(statement.openingBani)])
  opening.font = { bold: true }
  money(opening, [6])

  styleHeader(
    sheet.addRow([
      t('custom:statement:colDate'),
      t('custom:statement:colDocument'),
      t('custom:statement:colDescription'),
      t('custom:statement:colCharged'),
      t('custom:statement:colPaid'),
      t('custom:statement:colBalance'),
    ]),
  )

  if (statement.lines.length === 0) sheet.addRow(['', '', t('custom:statement:noMoves')]).font = { italic: true }

  for (const line of statement.lines) {
    const row = sheet.addRow([
      day(line.date),
      line.document ?? '',
      describe(t, line),
      line.chargedBani ? mdl(line.chargedBani) : null,
      line.paidBani ? mdl(line.paidBani) : null,
      mdl(line.balanceBani),
    ])
    money(row, [4, 5, 6])
  }

  const total = sheet.addRow(['', '', t('custom:statement:totalPeriod'), mdl(statement.chargedBani), mdl(statement.paidBani), ''])
  total.font = { bold: true }
  total.eachCell((cell) => (cell.border = { top: { style: 'thin' } }))
  money(total, [4, 5])

  const closing = sheet.addRow(['', '', t('custom:statement:closing'), '', '', mdl(statement.closingBani)])
  closing.font = { bold: true }
  money(closing, [6])

  sheet.addRow([])
  sheet.addRow([t('custom:statement:hint')]).font = { italic: true, color: { argb: 'FF666666' } }
}

const writeOrders = (workbook: ExcelJS.Workbook, t: T, statement: CustomerStatement, generatedAt: Date) => {
  const sheet = workbook.addWorksheet(t('custom:statement:sheetOrders'))
  sheet.columns = [{ width: 12 }, { width: 12 }, { width: 40 }, { width: 14 }, { width: 9 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 16 }]
  writeHeading(sheet, t, statement, generatedAt)

  styleHeader(
    sheet.addRow([
      t('custom:statement:colOrder'),
      t('custom:statement:colDate'),
      t('custom:statement:colProduct'),
      t('custom:statement:colArticle'),
      t('custom:statement:colQuantity'),
      t('custom:statement:colPrice'),
      t('custom:statement:colAmount'),
      t('custom:statement:colPaid'),
      t('custom:statement:colDue'),
    ]),
  )

  if (statement.orders.length === 0) sheet.addRow(['', '', t('custom:statement:noOrders')]).font = { italic: true }

  for (const order of statement.orders) {
    const status = statusKey(order.status)
    const payment = paymentKey(order.paymentState)
    const summary = [status && t(status), payment && t(payment)].filter(Boolean).join(', ')
    const head = sheet.addRow([
      order.number ?? order.id,
      day(order.date),
      summary,
      '',
      '',
      '',
      mdl(order.totalBani),
      mdl(order.paidBani),
      mdl(order.dueBani),
    ])
    head.font = { bold: true }
    head.eachCell({ includeEmpty: true }, (cell) => (cell.fill = ORDER_FILL))
    money(head, [7, 8, 9])

    for (const item of order.items) {
      const row = sheet.addRow(['', '', item.title, item.article ?? '', item.quantity, mdl(item.priceBani), mdl(item.amountBani)])
      money(row, [6, 7])
    }
  }

  if (statement.orders.length > 0) {
    const sum = (pick: (order: CustomerStatement['orders'][number]) => number) =>
      mdl(statement.orders.reduce((total, order) => total + pick(order), 0))
    const total = sheet.addRow([
      '',
      '',
      t('custom:statement:totalPeriod'),
      '',
      '',
      '',
      sum((order) => (order.status === 'cancelled' ? 0 : order.totalBani)),
      sum((order) => order.paidBani),
      sum((order) => order.dueBani),
    ])
    total.font = { bold: true }
    total.eachCell((cell) => (cell.border = { top: { style: 'thin' } }))
    money(total, [7, 8, 9])
  }
}

export const buildStatementWorkbook = async (statement: CustomerStatement, t: T, generatedAt = new Date()): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook()
  workbook.created = generatedAt

  writeMoves(workbook, t, statement, generatedAt)
  writeOrders(workbook, t, statement, generatedAt)

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
