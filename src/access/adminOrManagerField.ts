import type { FieldAccess } from 'payload'

import { checkRole } from '@/access/utilities'

export const adminOrManagerField: FieldAccess = ({ req: { user } }) => {
  if (user) return checkRole(['admin', 'manager'], user)

  return false
}
