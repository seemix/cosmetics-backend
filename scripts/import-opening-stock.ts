/**
 * Імпорт початкових залишків товару з CSV у чернетки `opening-balances` (docs/accounting/design.md, розд. 10).
 *
 * Запуск (з кореня проєкту, потрібен `.env` з DATABASE_URI):
 *   npx tsx scripts/import-opening-stock.ts <file.csv> [--date=2026-10-24]
 *
 * Формат рядка: `article; warehouseCode; qty; unitCostMDL` (роздільник `;`, перший рядок
 * із заголовком необов'язковий, десяткова кома або крапка). Склад указується в шапці документа,
 * тож скрипт створює окрему чернетку на кожен склад із файлу: провести їх може admin в адмінці.
 * Якщо в файлі є хоч одна помилка, жодна чернетка не створюється, а звіт перелічує всі проблеми
 * одразу, щоб виправити файл за один прохід.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import type { Payload } from 'payload'

import { toBani } from '../src/utilities/money'

export type ImportError = { line: number; message: string }

export type ImportReport = {
  /** Створені чернетки, по одній на склад у порядку першої появи у файлі; порожньо, якщо є помилки. */
  drafts: Array<{ id: number | string; number: string; warehouseCode: string; lines: number }>
  errors: ImportError[]
}

type ParsedRow = { line: number; article: string; warehouseCode: string; qty: string; cost: string }

const HEADER = /^article$/i

/** Розбирає CSV: порожні рядки пропускає, номер рядка лишається таким, як у файлі. */
export const parseCsv = (text: string): ParsedRow[] => {
  const rows: ParsedRow[] = []

  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      if (!raw.trim()) return
      const [article = '', warehouseCode = '', qty = '', cost = ''] = raw.split(';').map((cell) => cell.trim())

      if (index === 0 && HEADER.test(article)) return
      rows.push({ line: index + 1, article, warehouseCode, qty, cost })
    })

  return rows
}

type ResolvedLine = { product: string; quantity: number; unitCostBani: number }

export const importOpeningStock = async (
  payload: Payload,
  csv: string,
  { documentDate = new Date().toISOString() }: { documentDate?: string } = {},
): Promise<ImportReport> => {
  const errors: ImportError[] = []
  const byWarehouse = new Map<string, { code: string; lines: ResolvedLine[] }>()
  const seen = new Map<string, number>()
  const rows = parseCsv(csv)

  const productCache = new Map<string, string | null>()
  const warehouseCache = new Map<string, string | null>()

  const findProduct = async (article: string): Promise<{ id: string } | 'ambiguous' | null> => {
    const { docs } = await payload.find({
      collection: 'products',
      where: { article: { equals: article } },
      limit: 2,
      depth: 0,
      select: { article: true },
    })

    if (docs.length > 1) return 'ambiguous'
    return docs[0] ? { id: String(docs[0].id) } : null
  }

  for (const row of rows) {
    const report = (message: string) => errors.push({ line: row.line, message })
    let valid = true

    if (!row.article) {
      report('Article is empty')
      valid = false
    }

    const qty = Number(row.qty.replace(',', '.'))
    if (!row.qty || !Number.isInteger(qty) || qty <= 0) {
      report(`Quantity must be a whole number greater than 0, got "${row.qty}"`)
      valid = false
    }

    let unitCostBani = 0
    try {
      unitCostBani = toBani(row.cost)
      if (unitCostBani <= 0) throw new RangeError('not positive')
    } catch {
      report(`Unit cost must be greater than 0, got "${row.cost}"`)
      valid = false
    }

    let product: string | null = null
    if (row.article) {
      if (!productCache.has(row.article)) {
        const found = await findProduct(row.article)
        if (found === 'ambiguous') report(`Article "${row.article}" matches several products`)
        productCache.set(row.article, found && found !== 'ambiguous' ? found.id : null)
        if (found === null) report(`Unknown article "${row.article}"`)
        if (found === null || found === 'ambiguous') valid = false
      } else if (productCache.get(row.article) === null) {
        valid = false
      }
      product = productCache.get(row.article) ?? null
    }

    if (!warehouseCache.has(row.warehouseCode)) {
      const { docs } = await payload.find({
        collection: 'warehouses',
        where: { code: { equals: row.warehouseCode } },
        limit: 1,
        depth: 0,
      })
      warehouseCache.set(row.warehouseCode, docs[0] ? String(docs[0].id) : null)
      if (!docs[0]) report(`Unknown warehouse code "${row.warehouseCode}"`)
    }
    const warehouse = warehouseCache.get(row.warehouseCode) ?? null
    if (!warehouse) valid = false

    // Дубль шукаємо лише серед рядків, які самі по собі коректні: інакше одна помилка тягне другу.
    if (valid && product && warehouse) {
      const key = `${product}:${warehouse}`
      const first = seen.get(key)
      if (first !== undefined) {
        report(`Duplicate product × warehouse (first seen on line ${first})`)
        valid = false
      } else {
        seen.set(key, row.line)
      }
    }

    if (valid && product && warehouse) {
      const group = byWarehouse.get(warehouse) ?? { code: row.warehouseCode, lines: [] }
      group.lines.push({ product, quantity: qty, unitCostBani })
      byWarehouse.set(warehouse, group)
    }
  }

  if (rows.length === 0) errors.push({ line: 0, message: 'The file has no data rows' })
  if (errors.length > 0) return { drafts: [], errors }

  const drafts: ImportReport['drafts'] = []
  for (const [warehouse, group] of byWarehouse) {
    const draft = await payload.create({
      collection: 'opening-balances',
      data: { status: 'draft', kind: 'stock', documentDate, warehouse, stockLines: group.lines },
    })
    drafts.push({ id: draft.id, number: draft.number ?? '', warehouseCode: group.code, lines: group.lines.length })
  }

  return { drafts, errors }
}

export const formatReport = (report: ImportReport): string => {
  if (report.errors.length === 0 && report.drafts.length > 0) {
    return [
      `${report.drafts.length} draft(s) created. Review and post them in the admin panel:`,
      ...report.drafts.map((draft) => `  ${draft.number}: warehouse ${draft.warehouseCode}, ${draft.lines} lines`),
    ].join('\n')
  }

  return [
    `Import failed, no draft created. ${report.errors.length} problem(s):`,
    ...report.errors.map((error) => `  line ${error.line}: ${error.message}`),
  ].join('\n')
}

const main = async () => {
  const args = process.argv.slice(2)
  const file = args.find((arg) => !arg.startsWith('--'))
  const date = args.find((arg) => arg.startsWith('--date='))?.slice('--date='.length)

  if (!file) {
    console.error('Usage: tsx scripts/import-opening-stock.ts <file.csv> [--date=YYYY-MM-DD]')
    process.exit(2)
  }

  // tsx не читає .env сам, як це робить Next: підхоплюємо його до імпорту конфігу.
  const { loadEnv } = await import('payload/node')
  loadEnv()

  const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../src/payload.config')])
  const payload = await getPayload({ config })
  const report = await importOpeningStock(payload, readFileSync(file, 'utf8'), {
    documentDate: date ? new Date(date).toISOString() : undefined,
  })

  console.log(formatReport(report))
  process.exit(report.errors.length > 0 ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
