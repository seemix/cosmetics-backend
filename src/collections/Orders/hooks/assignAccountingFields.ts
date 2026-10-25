import type { CollectionBeforeChangeHook } from 'payload'

/** Ключ `req.context`, яким публічний `createOrder` позначає замовлення сайту. */
export const ORDER_SOURCE_CONTEXT_KEY = 'orderSource'

const relationID = (value: unknown): string | number | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return value as string | number
}

/**
 * Облікові поля замовлення (дизайн, розд. 2.5, 4.3).
 * Create: `source` за контекстом, склад (для сайту завжди з налаштувань, значення з тіла ігнорується),
 * автор і `accounting.revenueBani`. Update: `source`, `warehouse`, `createdBy` не змінюються.
 * Має йти після `populatePricesAndTotal`, бо виручка береться з готового `total`.
 */
export const assignAccountingFields: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (!data) return data

  if (operation === 'update') {
    if (originalDoc) {
      data.source = originalDoc.source
      data.warehouse = relationID(originalDoc.warehouse)
      data.createdBy = relationID(originalDoc.createdBy)
    }
    return data
  }

  const isWeb = req.context?.[ORDER_SOURCE_CONTEXT_KEY] === 'web'
  data.source = isWeb ? 'web' : 'admin'

  const settings = await req.payload.findGlobal({ slug: 'accounting-settings', depth: 0, req })
  data.warehouse = isWeb
    ? relationID(settings.defaultWebWarehouse)
    : (relationID(data.warehouse) ?? relationID(settings.defaultAdminWarehouse))

  data.createdBy = isWeb ? undefined : relationID(req.user?.id)

  data.accounting = {
    ...data.accounting,
    revenueBani: Math.round((Number(data.total) || 0) * 100),
  }
  data.paidBani = 0
  data.paymentState = 'unpaid'

  return data
}
