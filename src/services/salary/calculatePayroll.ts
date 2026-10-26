import { getOrderRevenueBani, type PaymentOrder } from '@/services/finance/orderPayments.service'

/**
 * Розрахунок зарплати менеджера за періодом (docs/accounting/design.md, розд. 7.2). Чиста функція:
 * без доступу до БД, замовлення вже відібрані `selectPayrollOrders`.
 */

export type SalaryBase = 'revenue' | 'gross_profit' | 'paid_revenue'

/** Параметри схеми, від яких залежить сума. */
export type PayrollSchemeParams = {
  fixedBani?: number | null
  /** Відсоток у базисних пунктах: 12,35 % = 1235. */
  percentBp: number
  base: SalaryBase
}

/** Замовлення для розрахунку: форма, з якої `getOrderRevenueBani` бере виручку. */
export type PayrollOrderData = PaymentOrder & {
  id: string
  accounting?: (PaymentOrder['accounting'] & { cogsBani?: number | null }) | null
  paymentState?: string | null
}

export type PayrollLine = {
  order: string
  orderNumber: string | null
  baseBani: number
  amountBani: number
}

export type PayrollResult = {
  lines: PayrollLine[]
  baseTotalBani: number
  percentAmountBani: number
  fixedBani: number
  totalBani: number
}

/**
 * База нарахування замовлення або `null`, якщо замовлення в цю базу не входить.
 * Від'ємний валовий прибуток (продаж нижче собівартості) лишається від'ємним: зменшує комісію.
 */
const baseOf = (order: PayrollOrderData, base: SalaryBase): number | null => {
  const revenueBani = getOrderRevenueBani(order)

  if (base === 'revenue') return revenueBani
  if (base === 'gross_profit') return revenueBani - (Number(order.accounting?.cogsBani) || 0)

  return order.paymentState === 'paid' ? revenueBani : null
}

/**
 * Комісія рахується на кожен рядок окремо з округленням до бана, підсумок = сума рядків
 * (а не округлення загальної суми). `totalBani = fixedBani + Σ рядків + adjustmentsBani`.
 */
export const calculatePayroll = ({
  scheme,
  orders,
  adjustmentsBani = 0,
}: {
  scheme: PayrollSchemeParams
  orders: PayrollOrderData[]
  adjustmentsBani?: number | null
}): PayrollResult => {
  const lines: PayrollLine[] = []

  for (const order of orders) {
    const baseBani = baseOf(order, scheme.base)
    if (baseBani === null) continue

    lines.push({
      order: order.id,
      orderNumber: order.orderNumber ?? null,
      baseBani,
      // `|| 0` прибирає -0 від'ємної бази.
      amountBani: Math.round((baseBani * scheme.percentBp) / 10000) || 0,
    })
  }

  const baseTotalBani = lines.reduce((sum, line) => sum + line.baseBani, 0)
  const percentAmountBani = lines.reduce((sum, line) => sum + line.amountBani, 0)
  const fixedBani = Number(scheme.fixedBani) || 0

  return {
    lines,
    baseTotalBani,
    percentAmountBani,
    fixedBani,
    totalBani: fixedBani + percentAmountBani + (Number(adjustmentsBani) || 0),
  }
}
