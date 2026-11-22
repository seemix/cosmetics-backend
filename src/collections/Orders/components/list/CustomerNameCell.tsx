import type { DefaultServerCellComponentProps } from 'payload'

const idOf = (value: unknown): string | null =>
  value && typeof value === 'object' ? String((value as { id?: unknown }).id ?? '') || null : value ? String(value) : null

const fullName = (name: unknown, surname: unknown): string =>
  [name, surname].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim()

/**
 * Клітинка «Клієнт» у списку замовлень: ім'я та прізвище з адреси доставки
 * (форма заповнює її з клієнта), а якщо там порожньо — з картки клієнта.
 */
export const OrderCustomerNameCell = async ({ cellData, payload, rowData }: DefaultServerCellComponentProps) => {
  const shippingName = (rowData as { shippingAddress?: { name?: unknown } } | undefined)?.shippingAddress?.name
  if (typeof shippingName === 'string' && shippingName.trim()) return <span>{shippingName.trim()}</span>

  const customerID = idOf(cellData)
  if (!customerID) return <span>—</span>

  const user = await payload
    .findByID({ collection: 'users', id: customerID, depth: 0, select: { name: true, surname: true, email: true } })
    .catch(() => null)
  if (!user) return <span>—</span>

  return <span>{fullName(user.name, (user as { surname?: unknown }).surname) || user.email || '—'}</span>
}
