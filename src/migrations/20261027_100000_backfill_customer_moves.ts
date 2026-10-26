import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// Баланс клієнта (розд. 6.4): `orders.paidBani` тепер дорівнює Σ `customer-moves.orderDeltaBani`.
// Наявні оплати переносимо в журнал: проведене чи сторноване надходження/повернення по замовленню
// дає рух датою операції, сторно ще й дзеркальний рух датою сторно. Авансів до цієї міграції не було.
const idOf = (value: unknown) =>
  value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : value ? String(value) : null

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const { docs } = await payload.find({
    collection: 'cash-operations',
    where: {
      type: { in: ['customer_receipt', 'customer_refund'] },
      status: { in: ['posted', 'reversed'] },
      order: { exists: true },
    },
    pagination: false,
    depth: 0,
    req,
  })

  let created = 0
  for (const operation of docs) {
    const order = idOf(operation.order)
    if (!order) continue

    const existing = await payload.count({
      collection: 'customer-moves',
      where: { docCollection: { equals: 'cash-operations' }, docId: { equals: String(operation.id) } },
      req,
    })
    if (existing.totalDocs > 0) continue

    const sign = operation.type === 'customer_receipt' ? 1 : -1
    const move = {
      customer: idOf(operation.customer),
      order,
      docCollection: 'cash-operations',
      docId: String(operation.id),
      docNumber: operation.number ?? undefined,
      advanceDeltaBani: 0,
    }

    await payload.create({
      collection: 'customer-moves',
      data: {
        ...move,
        date: operation.operationDate,
        kind: sign === 1 ? 'receipt' : 'refund',
        orderDeltaBani: sign * operation.amountBani,
      },
      req,
    })
    created += 1

    if (operation.status === 'reversed') {
      await payload.create({
        collection: 'customer-moves',
        data: { ...move, date: operation.reversedAt ?? operation.updatedAt, kind: 'reversal', orderDeltaBani: -sign * operation.amountBani },
        req,
      })
      created += 1
    }
  }

  payload.logger.info(`customer-moves: backfilled ${created} moves from ${docs.length} customer payments`)
}

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  // Журналу до цієї міграції не було: відкат прибирає його цілком разом з авансами.
  await payload.delete({ collection: 'customer-moves', where: { id: { exists: true } }, req })
  await payload.delete({ collection: 'customer-balances', where: { id: { exists: true } }, req })
  payload.logger.info('customer-moves: removed the customer journal and balances')
}
