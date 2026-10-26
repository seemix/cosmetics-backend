import type { Access } from 'payload'

import { checkRole } from '@/access/utilities'

export const adminOrManager: Access = ({ req: { user } }) => {
  if (user) return checkRole(['admin', 'manager'], user)

  return false
}
