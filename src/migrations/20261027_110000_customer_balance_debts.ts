import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

import { getCustomerDebts } from '@/services/finance/debts.service'

// Баланс клієнта (розд. 6.4): `customer-balances` тепер кешує ще борг (`debtBani`) і сальдо
// (`netBani` = борг − аванс). Заповнюємо їх для всіх клієнтів з боргом або документом балансу;
// клієнт з боргом, але без оплат, отримує документ балансу з авансом 0.
export async function up({ payload, req, session }: MigrateUpArgs): Promise<void> {
  const model = payload.db.collections['customer-balances']
  const debts = new Map<string, number>()
  for (const debt of await getCustomerDebts(req)) {
    if (debt.customer) debts.set(debt.customer, (debts.get(debt.customer) ?? 0) + debt.debtBani)
  }

  const existing = await model.collection.find<{ customer: { toString(): string } }>({}, { session, projection: { customer: 1 } }).toArray()
  const customers = new Set([...debts.keys(), ...existing.map((doc) => String(doc.customer))])
  const advance = { $ifNull: ['$balanceBani', 0] }
  const now = new Date()

  for (const customer of customers) {
    const debtBani = debts.get(customer) ?? 0
    await model.collection.updateOne(
      { customer: new model.base.Types.ObjectId(customer) },
      [
        {
          $set: {
            balanceBani: advance,
            debtBani,
            netBani: { $subtract: [debtBani, advance] },
            updatedAt: now,
            createdAt: { $ifNull: ['$createdAt', now] },
          },
        },
      ],
      { session, upsert: true },
    )
  }

  payload.logger.info(`customer-balances: debt and balance set for ${customers.size} customers`)
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const model = payload.db.collections['customer-balances']
  await model.collection.updateMany({}, { $unset: { debtBani: '', netBani: '' } }, { session })
  // Документи без авансу створила `up`: до неї документ балансу був лише в клієнта з рухами авансу.
  const moved = await payload.db.collections['customer-moves'].collection.distinct('customer', { customer: { $ne: null } }, { session })
  await model.collection.deleteMany({ customer: { $nin: moved }, balanceBani: 0 }, { session })
  payload.logger.info('customer-balances: debt and balance removed')
}
