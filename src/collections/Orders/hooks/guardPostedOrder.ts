import { APIError, type CollectionBeforeChangeHook } from 'payload'

import { customT } from '@/i18n'

type ItemLike = { product?: unknown; quantity?: unknown; price?: unknown }

const relationID = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return relationID((value as { id?: unknown }).id)
  return String(value)
}

const cents = (value: unknown): number => Math.round((Number(value) || 0) * 100)

const sameItems = (next: unknown, prev: unknown): boolean => {
  const a = Array.isArray(next) ? (next as ItemLike[]) : []
  const b = Array.isArray(prev) ? (prev as ItemLike[]) : []
  if (a.length !== b.length) return false

  return a.every(
    (item, i) =>
      relationID(item?.product) === relationID(b[i]?.product) &&
      Number(item?.quantity) === Number(b[i]?.quantity) &&
      cents(item?.price) === cents(b[i]?.price),
  )
}

/**
 * Проведене замовлення не змінює суму продажу (дизайн, розд. 9.2, F6).
 * На update перевіряються лише поля, що прийшли в `data`: адмінка надсилає весь документ,
 * тому однакові значення пропускаються, а змінені відхиляються.
 */
export const guardPostedOrder: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update' || !data || !originalDoc) return data

  // Скасування кінцеве (розд. 9.1): повернений залишок назад не списується.
  if (originalDoc.status === 'cancelled' && 'status' in data && data.status && data.status !== 'cancelled') {
    throw new APIError(customT(req.t)('custom:error:cancelledOrderFinal'), 409, undefined, true)
  }

  const changed =
    ('items' in data && data.items !== undefined && !sameItems(data.items, originalDoc.items)) ||
    ('total' in data && data.total !== undefined && cents(data.total) !== cents(originalDoc.total)) ||
    ('discount' in data && cents(data.discount) !== cents(originalDoc.discount)) ||
    ('customer' in data && relationID(data.customer) !== relationID(originalDoc.customer)) ||
    ('manager' in data && relationID(data.manager) !== relationID(originalDoc.manager))

  if (changed) {
    throw new APIError(customT(req.t)('custom:error:postedOrderLocked'), 400, undefined, true)
  }

  return data
}
