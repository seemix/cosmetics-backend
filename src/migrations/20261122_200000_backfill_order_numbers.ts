import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

import { ORDER_COUNTER_ID } from '@/collections/Orders/hooks/setOrderNumber'
import { nextCounterValue } from '@/services/counters'

type ObjectIdLike = { toString(): string }
type OrderDoc = { _id: ObjectIdLike; orderNumber?: string | null }

const WITHOUT_NUMBER = { $or: [{ orderNumber: { $exists: false } }, { orderNumber: null }, { orderNumber: '' }] }

/**
 * Номер замовлення — заголовок документа, тож старі замовлення без номера отримують його з того самого
 * лічильника, що й нові (`setOrderNumber`), від найстарішого. Номери з лічильника, тому вони більші
 * за вже видані. Лічильник працює поза транзакцією: якщо міграція відкотиться, лишаться пропуски в нумерації.
 */
export async function up({ payload, req, session }: MigrateUpArgs): Promise<void> {
  const orders = payload.db.collections.orders.collection

  /** Найбільший числовий номер: з нього стартує лічильник, якщо його ще немає. */
  const maxNumber = async (): Promise<number> => {
    const docs = await orders.find<OrderDoc>({ orderNumber: { $regex: /^\d+$/ } }, { session, projection: { orderNumber: 1 } }).toArray()
    return docs.reduce((max, doc) => Math.max(max, Number(doc.orderNumber)), 0)
  }

  const docs = await orders
    .find<OrderDoc>(WITHOUT_NUMBER, { session, sort: { createdAt: 1, _id: 1 }, projection: { _id: 1 } })
    .toArray()

  const assigned: string[] = []
  for (const order of docs) {
    const orderNumber = String(await nextCounterValue(req, ORDER_COUNTER_ID, maxNumber))
    await orders.updateOne({ _id: order._id }, { $set: { orderNumber } }, { session })
    assigned.push(orderNumber)
  }

  payload.logger.info(
    `order numbers: assigned ${assigned.length} orders` + (assigned.length > 0 ? ` (${assigned[0]}–${assigned.at(-1)})` : ''),
  )
}

/** Відкат не прибирає номери: замовлення лишаються з номерами, лічильник не змінюється. */
export async function down({ payload }: MigrateDownArgs): Promise<void> {
  payload.logger.info('order numbers: nothing to revert, assigned numbers are kept')
}
