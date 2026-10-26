import { expensesReport } from './expenses'
import { profitReport } from './profit'
import { purchasesReport } from './purchases'

/** Ендпоінти звітів `GET /api/reports/*` (R1, docs/accounting/design.md, розд. 12). */
export const reportEndpoints = [profitReport, expensesReport, purchasesReport]
