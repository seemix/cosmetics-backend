import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

type StockLine = { warehouse?: unknown }
type OpeningDoc = { _id: { toString(): string }; number?: string; warehouse?: unknown; stockLines?: StockLine[] }

// Склад початкових залишків kind=stock переїхав з рядків у шапку документа: один склад на документ.
// Документ з рядками одного складу отримує його в шапку; документ з кількома складами лишається як є
// (проведений уже має рухи по своїх складах, чернетку треба розбити вручну) і потрапляє в лог.
export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const model = payload.db.collections['opening-balances']
  const docs = await model.collection
    .find<OpeningDoc>({ kind: 'stock', warehouse: { $exists: false } }, { session })
    .toArray()
  let moved = 0

  for (const doc of docs) {
    const warehouses = new Map((doc.stockLines ?? []).map((line) => [String(line.warehouse), line.warehouse]))
    if (warehouses.size !== 1) {
      payload.logger.warn(`opening-balances ${doc.number}: lines span ${warehouses.size} warehouses, set the warehouse manually`)
      continue
    }

    await model.collection.updateOne(
      { _id: new model.base.Types.ObjectId(String(doc._id)) },
      { $set: { warehouse: [...warehouses.values()][0] }, $unset: { 'stockLines.$[].warehouse': '' } },
      { session },
    )
    moved++
  }

  payload.logger.info(`opening-balances: warehouse moved to the header in ${moved} of ${docs.length} stock documents`)
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const model = payload.db.collections['opening-balances']
  const docs = await model.collection
    .find<OpeningDoc>({ kind: 'stock', warehouse: { $exists: true } }, { session })
    .toArray()

  for (const doc of docs) {
    await model.collection.updateOne(
      { _id: new model.base.Types.ObjectId(String(doc._id)) },
      { $set: { 'stockLines.$[].warehouse': doc.warehouse }, $unset: { warehouse: '' } },
      { session },
    )
  }

  payload.logger.info(`opening-balances: warehouse moved back to lines in ${docs.length} stock documents`)
}
