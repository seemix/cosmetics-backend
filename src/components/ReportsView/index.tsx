import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { notFound } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { checkRole } from '@/access/utilities'
import { ACCOUNTING_TIME_ZONE } from '@/utilities/period'

import { ReportsView } from './ReportsView'

/**
 * Серверна обгортка сторінки `/admin/reports` (R2). Лише admin: інші ролі отримують 404, як і неіснуюча
 * сторінка. Клієнту передаються тільки мова, пояс звітів і маршрути; дані він бере з `/api/reports/*`.
 */
export const ReportsPage = ({ i18n, initPageResult, params, payload, searchParams }: AdminViewServerProps) => {
  const { req, locale, permissions, visibleEntities } = initPageResult

  if (!checkRole(['admin'], req.user)) notFound()

  return (
    <DefaultTemplate
      i18n={i18n}
      locale={locale}
      params={params}
      payload={payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      visibleEntities={visibleEntities}
    >
      <Gutter>
        <ReportsView
          language={i18n.language}
          timeZone={ACCOUNTING_TIME_ZONE}
          adminRoute={payload.config.routes.admin}
          apiRoute={payload.config.routes.api}
        />
      </Gutter>
    </DefaultTemplate>
  )
}
