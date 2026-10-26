/**
 * Масове призначення менеджерів клієнтам з CSV (docs/accounting/tasks.md, M2).
 *
 * Запуск (з кореня проєкту, потрібен `.env` з DATABASE_URI):
 *   npx tsx scripts/import-customer-managers.ts <file.csv> [--apply] [--overwrite]
 *
 * Формат рядка: `customerEmail;managerEmail` (роздільник `;`, перший рядок із заголовком
 * необов'язковий). За замовчуванням dry-run: нічого не пишеться, друкується звіт.
 * `--apply` записує, `--overwrite` дозволяє замінити іншого менеджера, який уже призначений.
 * Запис через Local API з `overrideAccess`, по рядках; помилка одного рядка не зупиняє інші.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import type { Payload } from 'payload'

export type ImportError = { line: number; message: string }

export type ImportReport = {
  /** Рядки, які буде записано (dry-run) або записано (--apply). */
  planned: number
  written: number
  skipped: number
  errors: ImportError[]
  applied: boolean
}

type ParsedRow = { line: number; customerEmail: string; managerEmail: string }

const HEADER = /^customeremail$/i

export const parseCsv = (text: string): ParsedRow[] => {
  const rows: ParsedRow[] = []

  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      if (!raw.trim()) return
      const [customerEmail = '', managerEmail = ''] = raw.split(';').map((cell) => cell.trim())

      if (index === 0 && HEADER.test(customerEmail)) return
      rows.push({ line: index + 1, customerEmail, managerEmail })
    })

  return rows
}

type UserLite = { id: string; roles: string[]; manager: string | null }

export const importCustomerManagers = async (
  payload: Payload,
  csv: string,
  { apply = false, overwrite = false }: { apply?: boolean; overwrite?: boolean } = {},
): Promise<ImportReport> => {
  const errors: ImportError[] = []
  const rows = parseCsv(csv)
  const cache = new Map<string, UserLite | null>()
  const seenCustomers = new Map<string, number>()
  const toWrite: Array<{ line: number; customer: UserLite; manager: UserLite }> = []
  let skipped = 0

  const findUser = async (email: string): Promise<UserLite | null> => {
    const key = email.toLowerCase()
    if (cache.has(key)) return cache.get(key) ?? null

    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: key } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const doc = docs[0]
    const manager = doc?.manager
    const user = doc
      ? {
          id: doc.id,
          roles: (doc.roles ?? []) as string[],
          manager: manager ? String(typeof manager === 'object' ? manager.id : manager) : null,
        }
      : null
    cache.set(key, user)
    return user
  }

  for (const row of rows) {
    const report = (message: string) => errors.push({ line: row.line, message })

    if (!row.customerEmail || !row.managerEmail) {
      report('Both customerEmail and managerEmail are required')
      continue
    }

    const customerKey = row.customerEmail.toLowerCase()
    const first = seenCustomers.get(customerKey)
    if (first !== undefined) {
      report(`Duplicate customer "${row.customerEmail}" (first seen on line ${first})`)
      continue
    }
    seenCustomers.set(customerKey, row.line)

    const customer = await findUser(row.customerEmail)
    const manager = await findUser(row.managerEmail)
    let valid = true

    if (!customer) {
      report(`Unknown customer email "${row.customerEmail}"`)
      valid = false
    } else if (customer.roles.includes('admin') || customer.roles.includes('manager')) {
      report(`"${row.customerEmail}" has the admin or manager role and cannot be a customer`)
      valid = false
    }

    if (!manager) {
      report(`Unknown manager email "${row.managerEmail}"`)
      valid = false
    } else if (!manager.roles.includes('manager')) {
      report(`"${row.managerEmail}" does not have the manager role`)
      valid = false
    }

    if (!valid || !customer || !manager) continue

    if (customer.manager !== null && customer.manager !== String(manager.id)) {
      if (!overwrite) {
        report(`Customer "${row.customerEmail}" already has another manager (use --overwrite to replace)`)
        skipped++
        continue
      }
    } else if (customer.manager === String(manager.id)) {
      skipped++
      continue
    }

    toWrite.push({ line: row.line, customer, manager })
  }

  let written = 0
  if (apply) {
    for (const { line, customer, manager } of toWrite) {
      try {
        // Лише поле manager: хуки Users на update листів не шлють (verify і forgotPassword лише на create/reset).
        await payload.update({
          collection: 'users',
          id: customer.id,
          data: { manager: manager.id },
          overrideAccess: true,
          depth: 0,
        })
        written++
      } catch (error) {
        errors.push({ line, message: `Write failed: ${(error as Error).message}` })
      }
    }
  }

  return { planned: toWrite.length, written, skipped, errors, applied: apply }
}

export const formatReport = (report: ImportReport): string => {
  const lines = report.errors.map((error) => `  line ${error.line}: ${error.message}`)
  const summary = report.applied
    ? `Applied: written ${report.written}, skipped ${report.skipped}, errors ${report.errors.length}.`
    : `Dry-run, nothing written: would write ${report.planned}, skipped ${report.skipped}, errors ${report.errors.length}. Run with --apply to write.`

  return [summary, ...lines].join('\n')
}

const main = async () => {
  const args = process.argv.slice(2)
  const file = args.find((arg) => !arg.startsWith('--'))

  if (!file) {
    console.error('Usage: tsx scripts/import-customer-managers.ts <file.csv> [--apply] [--overwrite]')
    process.exit(2)
  }

  const { loadEnv } = await import('payload/node')
  loadEnv()

  const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../src/payload.config')])
  const payload = await getPayload({ config })
  const report = await importCustomerManagers(payload, readFileSync(file, 'utf8'), {
    apply: args.includes('--apply'),
    overwrite: args.includes('--overwrite'),
  })

  console.log(formatReport(report))
  process.exit(report.errors.length > 0 ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
