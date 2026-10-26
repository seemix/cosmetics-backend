import { APIError, type Endpoint, type PayloadRequest } from 'payload'

import { checkRole } from '@/access/utilities'
import { customT, type CustomTranslationsKeys } from '@/i18n'
import { getOrderRevenueBani } from '@/services/finance/orderPayments.service'
import { formatMDL } from '@/utilities/money'

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' && 'id' in value
    ? String((value as { id: unknown }).id)
    : value
      ? String(value)
      : null

const fail = (req: PayloadRequest, key: CustomTranslationsKeys, status: number, variables?: Record<string, string>): never => {
  throw new APIError(customT(req.t)(key, variables), status, undefined, true)
}

/**
 * Кнопка «Прийняти оплату» в замовленні: створює чернетку `customer_receipt` (розд. 6.2) з готовими
 * касою (за `paymentType`: готівка → каса `cash`, переказ → `bank`), замовленням, клієнтом і сумою
 * залишку. Проводить її адмін сам, тож оплата лишається підтвердженою людиною. Якщо чернетка
 * надходження по цьому замовленню вже є, повертає її, а не створює дубль.
 */
export const acceptPayment: Endpoint = {
  path: '/:id/accept-payment',
  method: 'post',

  handler: async (req: PayloadRequest): Promise<Response> => {
    try {
      if (!checkRole(['admin'], req.user)) return Response.json({ message: 'Forbidden' }, { status: 403 })

      const id = String(req.routeParams?.id ?? '')
      const order = await req.payload.findByID({ collection: 'orders', id, depth: 0, req })
      const number = order.orderNumber ?? id

      if (order.status === 'cancelled') fail(req, 'custom:error:paymentOrderCancelled', 409, { order: number })

      const existing = await req.payload.find({
        collection: 'cash-operations',
        where: { order: { equals: id }, type: { equals: 'customer_receipt' }, status: { equals: 'draft' } },
        limit: 1,
        depth: 0,
        req,
      })
      if (existing.docs[0]) return Response.json({ id: existing.docs[0].id })

      const dueBani = getOrderRevenueBani(order) - (order.paidBani ?? 0)
      if (dueBani <= 0) fail(req, 'custom:error:paymentNothingDue', 409, { order: number })

      const kind = order.paymentType === 'transfer' ? 'bank' : 'cash'
      const { docs: accounts } = await req.payload.find({
        collection: 'cash-accounts',
        where: { isActive: { equals: true }, kind: { equals: kind } },
        sort: 'name',
        limit: 1,
        depth: 0,
        req,
      })
      if (!accounts[0]) {
        const kindLabel = customT(req.t)(kind === 'bank' ? 'custom:option:accountBank' : 'custom:option:accountCash')
        fail(req, 'custom:error:paymentNoCashAccount', 409, { kind: kindLabel, order: number })
      }

      const operation = await req.payload.create({
        collection: 'cash-operations',
        data: {
          type: 'customer_receipt',
          status: 'draft',
          operationDate: new Date().toISOString(),
          account: accounts[0].id,
          order: id,
          customer: idOf(order.customer),
          amountBani: dueBani,
          comment: `${number}: ${formatMDL(dueBani)}`,
        },
        depth: 0,
        req,
      })

      return Response.json({ id: operation.id }, { status: 201 })
    } catch (error) {
      if (error instanceof APIError) {
        return Response.json({ message: error.message }, { status: error.status })
      }
      req.payload.logger.error({ err: error, msg: 'acceptPayment failed' })
      return Response.json({ message: 'Internal error' }, { status: 500 })
    }
  },
}
