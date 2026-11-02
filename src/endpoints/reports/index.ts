import { debtsReport } from './debts'
import { expensesReport } from './expenses'
import { profitReport } from './profit'
import { purchasesReport } from './purchases'
import { salaryReport } from './salary'
import { salesReport, salesTransfer } from './sales'
import { stockReport } from './stock'

/** Ендпоінти звітів `GET /api/reports/*` (R1, docs/accounting/design.md, розд. 12): лише читання. */
export const reportEndpoints = [stockReport, purchasesReport, expensesReport, profitReport, debtsReport, salaryReport, salesReport]

/** Дії на основі звітів (`POST`): створюють документи-чернетки. */
export const reportActionEndpoints = [salesTransfer]
