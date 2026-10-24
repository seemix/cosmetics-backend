import {
  MigrateDownArgs,
  MigrateUpArgs,
} from '@payloadcms/db-mongodb'

// T32 (D4): поле промокоду `'discount %'` перейменовано на `discountPercent`.
// Перед запуском на проді зробити резервну копію колекції `promo-codes` (mongodump).
const OLD_FIELD = 'discount %'
const NEW_FIELD = 'discountPercent'

export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const { modifiedCount } = await payload.db.collections['promo-codes'].collection.updateMany(
    { [OLD_FIELD]: { $exists: true } },
    { $rename: { [OLD_FIELD]: NEW_FIELD } },
    { session },
  )
  payload.logger.info(`promo-codes: renamed "${OLD_FIELD}" -> "${NEW_FIELD}" in ${modifiedCount} docs`)
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const { modifiedCount } = await payload.db.collections['promo-codes'].collection.updateMany(
    { [NEW_FIELD]: { $exists: true } },
    { $rename: { [NEW_FIELD]: OLD_FIELD } },
    { session },
  )
  payload.logger.info(`promo-codes: renamed "${NEW_FIELD}" -> "${OLD_FIELD}" in ${modifiedCount} docs`)
}
