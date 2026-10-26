import Link from 'next/link'
import type { ServerProps } from 'payload'

import { checkRole } from '@/access/utilities'
import { customT } from '@/i18n/labels'

/** Посилання «Звіти» в бічному меню (`admin.components.afterNavLinks`), лише для admin. */
export const ReportsNavLink = ({ i18n, payload, user }: ServerProps) => {
  if (!checkRole(['admin'], user)) return null

  const adminRoute = payload.config.routes.admin
  const href = `${adminRoute === '/' ? '' : adminRoute}/reports`

  return (
    <Link href={href}>
      {customT(i18n.t)('custom:reports:navLink')}
    </Link>
  )
}
