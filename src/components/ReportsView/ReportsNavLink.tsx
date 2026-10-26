import type { ServerProps } from 'payload'
import { NavLink } from 'payload-sidebar-plugin/components'

import { checkRole } from '@/access/utilities'
import { customT } from '@/i18n/labels'

/**
 * Посилання «Звіти» в бічному меню (`admin.components.afterNavLinks`), лише для admin.
 * Рендериться компонентом `NavLink` плагіна, тож має той самий вигляд, що й решта пунктів.
 */
export const ReportsNavLink = ({ i18n, payload, user }: ServerProps) => {
  if (!checkRole(['admin'], user)) return null

  const adminRoute = payload.config.routes.admin
  const href = `${adminRoute === '/' ? '' : adminRoute}/reports`

  return (
    <NavLink href={href} id="nav-custom-reports" slug="reports" type="custom" customIcon="pie-chart">
      <span className="nav__link-label">{customT(i18n.t)('custom:reports:navLink')}</span>
    </NavLink>
  )
}
