import type { Endpoint, PayloadRequest } from 'payload'

import { checkRole } from '@/access/utilities'
import { customT } from '@/i18n'
import { MAX_PERIOD_DAYS, ReportParams, ReportParamsError } from '@/services/reports/params'

/**
 * Спільне для `GET /api/reports/*` (R1): явна перевірка ролі (D7), відповіді без кешу, коди помилок
 * стабільні англійські, повідомлення мовою адмінки (`req.t`).
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

export const reportResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: NO_STORE })

/** Лише admin: без користувача 401, будь-яка інша роль (зокрема manager) 403. */
export const requireAdmin = (req: PayloadRequest): Response | null => {
  const t = customT(req.t)

  if (!req.user) return reportResponse({ code: 'UNAUTHORIZED', message: t('custom:error:reportUnauthorized') }, 401)
  if (!checkRole(['admin'], req.user)) {
    return reportResponse({ code: 'FORBIDDEN', message: t('custom:error:reportForbidden') }, 403)
  }

  return null
}

const paramsErrorResponse = (req: PayloadRequest, error: ReportParamsError): Response => {
  const t = customT(req.t)
  const message =
    error.code === 'PERIOD_TOO_LONG'
      ? t('custom:error:reportPeriodTooLong', { days: String(MAX_PERIOD_DAYS) })
      : t('custom:error:reportInvalidParams', { fields: error.fields.map((item) => item.field).join(', ') })

  return reportResponse({ code: error.code, message, fields: error.fields }, 400)
}

/**
 * Тонкий ендпоінт звіту: роль, параметри, сервіс, відповідь. `run` читає параметри через
 * `ReportParams`, викликає `params.finish()` до звернення до сервісу і повертає тіло відповіді.
 */
export const reportEndpoint = (
  name: string,
  run: (req: PayloadRequest, params: ReportParams) => Promise<unknown>,
): Endpoint => ({
  path: `/reports/${name}`,
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const denied = requireAdmin(req)
    if (denied) return denied

    try {
      return reportResponse(await run(req, new ReportParams(req)))
    } catch (error) {
      if (error instanceof ReportParamsError) return paramsErrorResponse(req, error)

      // Без кешу й для збою: інакше Payload відповів би 500 без заголовка.
      req.payload.logger.error({ err: error, msg: `report ${name} failed` })
      return reportResponse({ code: 'INTERNAL_ERROR', message: req.t('error:unknown') }, 500)
    }
  },
})
