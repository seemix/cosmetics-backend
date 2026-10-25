import { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

// A3: довідник складів і глобал налаштувань обліку.
// Сидимо склади `main` і `shop`; `defaultWebWarehouse` вказує на `main`, якщо ще не заданий.
const WAREHOUSES = [
  { code: 'main', name: 'Основний', sortOrder: 0 },
  { code: 'shop', name: 'Магазин', sortOrder: 1 },
] as const

export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const ids: Record<string, number | string> = {}

  for (const warehouse of WAREHOUSES) {
    const existing = await payload.find({
      collection: 'warehouses',
      where: { code: { equals: warehouse.code } },
      limit: 1,
      depth: 0,
      req,
    })

    const doc =
      existing.docs[0] ??
      (await payload.create({
        collection: 'warehouses',
        data: { ...warehouse, isActive: true },
        req,
      }))
    ids[warehouse.code] = doc.id
  }

  const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  if (!settings.defaultWebWarehouse) {
    await payload.updateGlobal({
      slug: 'accounting-settings',
      data: { defaultWebWarehouse: ids.main as never },
      req,
    })
  }
  payload.logger.info('warehouses: seeded main, shop; accounting-settings.defaultWebWarehouse = main')
}

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  const codes = WAREHOUSES.map((warehouse) => warehouse.code)

  const settings = await payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  if (settings.defaultWebWarehouse || settings.defaultAdminWarehouse) {
    // Прибираємо посилання напряму: `defaultWebWarehouse` обов'язкове для updateGlobal.
    await payload.db.globals.updateOne(
      { globalType: 'accounting-settings' },
      { $unset: { defaultWebWarehouse: '', defaultAdminWarehouse: '' } },
    )
  }

  await payload.delete({ collection: 'warehouses', where: { code: { in: codes } }, req })
  payload.logger.info('warehouses: removed main, shop')
}
