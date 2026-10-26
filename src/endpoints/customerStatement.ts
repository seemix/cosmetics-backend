import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdmin } from '@/endpoints/stockCacheCheck'
import { customT } from '@/i18n'
import { getCustomerStatement } from '@/services/finance/customerStatement.service'
import { buildStatementHtml } from '@/services/finance/customerStatement.html'
import { periodBounds } from '@/utilities/period'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const OBJECT_ID = /^[0-9a-f]{24}$/i

const validDay = (value: string | null | undefined): value is string =>
  Boolean(value && DAY.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))

/** Ім'я файлу: ASCII для старих клієнтів і повне UTF-8 у `filename*`. */
const contentDisposition = (name: string) => {
  const ascii = name.replace(/[^\w.-]+/g, '_')

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * `GET /api/customer-balances/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD`: виписка по клієнту
 * документа балансу за період як HTML-файл (розд. 6.5). Лише admin, роль перевіряється першою.
 */
export const customerStatement: Endpoint = {
  path: '/:id/statement',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    const t = customT(req.t)
    const id = String(req.routeParams?.id ?? '')
    const from = req.searchParams?.get('from')
    const to = req.searchParams?.get('to')

    if (!validDay(from) || !validDay(to) || from > to) {
      return Response.json({ message: t('custom:statement:invalidPeriod') }, { status: 400 })
    }
    if (!OBJECT_ID.test(id)) return Response.json({ message: 'Not Found' }, { status: 404 })

    const model = req.payload.db.collections['customer-balances']
    const balance = await model.collection.findOne<{ customer?: { toString(): string } }>(
      { _id: new model.base.Types.ObjectId(id) },
      { projection: { customer: 1 } },
    )
    if (!balance?.customer) return Response.json({ message: 'Not Found' }, { status: 404 })

    const { from: start, to: end } = periodBounds(from, to)
    const statement = await getCustomerStatement(req, { customer: String(balance.customer), from, to, start, end })
    const html = buildStatementHtml(statement, t)
    const who = statement.customer.name ?? statement.customer.email ?? statement.customer.id

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': contentDisposition(`${t('custom:statement:title')} ${who} ${from}_${to}.html`),
        'Cache-Control': 'no-store',
      },
    })
  },
}
