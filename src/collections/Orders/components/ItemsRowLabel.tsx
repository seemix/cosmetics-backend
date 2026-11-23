'use client'

import { useEffect, useState } from 'react'
import { useConfig, useRowLabel, useTranslation } from '@payloadcms/ui'

import { customT } from '@/i18n/labels'

import './itemsField.css'

type RowData = { product?: unknown }
type ProductValue = { id?: unknown; title?: unknown; value?: unknown }

const idOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value && typeof value === 'object') {
    const record = value as ProductValue
    const nested = record.value ?? record.id
    return nested && nested !== value ? idOf(nested) : null
  }
  return null
}

const titleOf = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as ProductValue
  if (typeof record.title === 'string' && record.title.trim()) return record.title
  const nested = record.value
  return nested && nested !== value ? titleOf(nested) : null
}

/** Підпис згорнутого рядка товарів: «Item 01» і назва товару дрібним шрифтом. */
export const OrderItemRowLabel = () => {
  const { data, rowNumber } = useRowLabel<RowData>()
  const { config } = useConfig()
  const { t, i18n } = useTranslation()
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null)

  const product = data?.product
  const inlineTitle = titleOf(product)
  const productId = idOf(product)
  const language = i18n?.language
  const locale = language === 'ru' || language === 'ro' ? language : undefined

  useEffect(() => {
    if (inlineTitle || !productId) {
      setFetchedTitle(null)
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams({ depth: '0' })
    if (locale) params.set('locale', locale)

    fetch(`${config.routes.api}/products/${encodeURIComponent(productId)}?${params}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((doc) => {
        if (!controller.signal.aborted && doc && typeof doc.title === 'string') {
          setFetchedTitle(doc.title)
        }
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [config.routes.api, inlineTitle, locale, productId])

  const title = inlineTitle ?? fetchedTitle
  const number = customT(t)('custom:orderForm:itemRow', {
    number: String((rowNumber ?? 0) + 1).padStart(2, '0'),
  })

  return (
    <span className="orders-item-row-label">
      {number}
      {title && (
        <span className="orders-item-row-label__title" title={title}>
          {title}
        </span>
      )}
    </span>
  )
}
