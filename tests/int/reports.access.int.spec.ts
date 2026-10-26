import { getPayload, type Endpoint, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { reportEndpoints } from '@/endpoints/reports'
import { expensesReport } from '@/endpoints/reports/expenses'
import { profitReport } from '@/endpoints/reports/profit'
import { purchasesReport } from '@/endpoints/reports/purchases'
import config from '@/payload.config'

import { type Caller, callReport } from './helpers/reports'

let payload: Payload

const period = { from: '2003-01-01', to: '2003-01-31' }

/** Кожен шлях звітів: валідні параметри й набір неправильних з очікуваною помилкою. */
const cases: Array<{
  endpoint: Endpoint
  valid: Record<string, string>
  invalid: Array<{ query: Record<string, string>; code: string; fields?: Array<{ field: string; reason: string }> }>
}> = [
  {
    endpoint: profitReport,
    valid: period,
    invalid: [
      { query: {}, code: 'INVALID_PARAMS', fields: [{ field: 'from', reason: 'required' }, { field: 'to', reason: 'required' }] },
      { query: { from: '2003-02-30', to: '2003-03-01' }, code: 'INVALID_PARAMS', fields: [{ field: 'from', reason: 'format' }] },
      { query: { from: '03.01.2003', to: '2003-03-01' }, code: 'INVALID_PARAMS', fields: [{ field: 'from', reason: 'format' }] },
      { query: { from: '2003-03-02', to: '2003-03-01' }, code: 'INVALID_PARAMS', fields: [{ field: 'to', reason: 'order' }] },
      { query: { from: '2003-01-01', to: '2004-02-05' }, code: 'PERIOD_TOO_LONG' },
    ],
  },
  {
    endpoint: expensesReport,
    valid: { ...period, page: '1', limit: '200' },
    invalid: [
      { query: { ...period, limit: '201' }, code: 'INVALID_PARAMS', fields: [{ field: 'limit', reason: 'range' }] },
      { query: { ...period, page: '0' }, code: 'INVALID_PARAMS', fields: [{ field: 'page', reason: 'range' }] },
      { query: { ...period, page: '-1' }, code: 'INVALID_PARAMS', fields: [{ field: 'page', reason: 'format' }] },
      { query: { ...period, category: '{"$ne":null}' }, code: 'INVALID_PARAMS', fields: [{ field: 'category', reason: 'format' }] },
    ],
  },
  {
    endpoint: purchasesReport,
    valid: period,
    invalid: [
      { query: { ...period, supplier: 'abc' }, code: 'INVALID_PARAMS', fields: [{ field: 'supplier', reason: 'format' }] },
      {
        query: { ...period, supplier: 'ffffffffffffffffffffffff' },
        code: 'INVALID_PARAMS',
        fields: [{ field: 'supplier', reason: 'not_found' }],
      },
    ],
  },
]

const expected: Record<Caller, number> = { guest: 401, customer: 403, manager: 403, admin: 200 }
const codes: Partial<Record<Caller, string>> = { guest: 'UNAUTHORIZED', customer: 'FORBIDDEN', manager: 'FORBIDDEN' }

describe('R1: доступ до звітів і параметри', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('кожен зареєстрований шлях звіту покритий цим тестом і зареєстрований у конфігурації', () => {
    const covered = cases.map((item) => item.endpoint.path).sort()

    expect(reportEndpoints.map((endpoint) => endpoint.path).sort()).toEqual(covered)
    for (const path of covered) {
      expect(payload.config.endpoints.some((endpoint) => endpoint.path === path && endpoint.method === 'get')).toBe(true)
    }
  })

  describe.each(cases)('$endpoint.path', ({ endpoint, valid, invalid }) => {
    it.each(Object.keys(expected) as Caller[])('%s → очікуваний статус і Cache-Control: no-store', async (caller) => {
      const { status, cacheControl, body } = await callReport(payload, endpoint, valid, caller)

      expect(status).toBe(expected[caller])
      expect(cacheControl).toBe('no-store')
      if (codes[caller]) {
        expect(body.code).toBe(codes[caller])
        expect(typeof body.message).toBe('string')
      } else {
        expect(body).toMatchObject({ currency: 'MDL', unit: 'bani' })
      }
    })

    it('роль перевіряється раніше за параметри: manager із неправильними параметрами отримує 403', async () => {
      const { status } = await callReport(payload, endpoint, invalid[0].query, 'manager')
      expect(status).toBe(403)
    })

    it.each(invalid)('неправильні параметри $query → 400 $code', async ({ query, code, fields }) => {
      const { status, cacheControl, body } = await callReport(payload, endpoint, query)

      expect(status).toBe(400)
      expect(cacheControl).toBe('no-store')
      expect(body.code).toBe(code)
      expect(typeof body.message).toBe('string')
      if (fields) expect(body.fields).toEqual(fields)
    })
  })

  it('повідомлення мовою адмінки (req.t)', async () => {
    const { createLocalReq } = await import('payload')
    const { initI18n } = await import('@payloadcms/translations')
    const i18n = await initI18n({ config: payload.config.i18n, context: 'api', language: 'ru' })
    const req = await createLocalReq({ req: { i18n, t: i18n.t, searchParams: new URLSearchParams() } as never }, payload)
    const body = await (await profitReport.handler(req)).json()

    expect(body).toEqual({ code: 'UNAUTHORIZED', message: 'Войдите, чтобы просматривать отчёты' })
  })
})
