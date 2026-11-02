import type { CollectionAfterChangeHook } from 'payload'

import { releaseOrderPayment, settleCustomer } from '@/services/finance/customerBalance.service'
import { requireSession } from '@/services/stock/session'

const idOf = (value: unknown) =>
  value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : value ? String(value) : null

/**
 * Баланс клієнта й замовлення (дизайн, розд. 6.4), у транзакції `req`:
 * - щойно проведене замовлення клієнта (створене відвантаженим або відвантажене, В20) одразу
 *   гаситься його авансом, зокрема передоплатою за це замовлення;
 * - скасоване замовлення клієнта повертає свою оплату на аванс, і той гасить інші борги.
 * Гостьові замовлення балансу не мають. Має йти після `cancelOrderStock`, до сповіщень.
 */
export const settleCustomerBalance: CollectionAfterChangeHook = async ({ doc, previousDoc, operation, req }) => {
  const customer = idOf(doc.customer)
  if (!customer) return doc

  const ref = { collection: 'orders', id: String(doc.id), number: doc.orderNumber ?? undefined }
  const justPosted = Boolean(doc.accounting?.stockPostedAt) && (operation === 'create' || !previousDoc?.accounting?.stockPostedAt)

  if (justPosted) {
    await settleCustomer(req, { customer, first: String(doc.id), doc: ref, date: new Date(doc.accounting.stockPostedAt) })
  } else if (operation === 'update' && doc.status === 'cancelled' && previousDoc?.status !== 'cancelled') {
    const cancelledAt = doc.accounting?.cancelledAt
    await releaseOrderPayment(req, { order: String(doc.id), customer, doc: ref, date: cancelledAt ? new Date(cancelledAt) : new Date() })
  } else {
    return doc
  }

  // Оплату змінили сирим запитом, тож відповідь бере свіжі значення.
  const session = await requireSession(req)
  const fresh = await req.payload.db.collections['orders'].collection.findOne<{ paidBani?: number; paymentState?: string }>(
    { _id: new req.payload.db.collections['orders'].base.Types.ObjectId(String(doc.id)) },
    { session, projection: { paidBani: 1, paymentState: 1 } },
  )

  return { ...doc, paidBani: fresh?.paidBani ?? doc.paidBani, paymentState: fresh?.paymentState ?? doc.paymentState }
}
