'use client'

import { useEffect, useRef, useState } from 'react'
import { NumberField, useField, useFormFields } from '@payloadcms/ui'
import type { NumberFieldClientComponent } from 'payload'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRelationshipID(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (isRecord(value)) {
    return getRelationshipID(value.value ?? value.id ?? value._id)
  }

  return null
}

function toPrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

export const PriceField: NumberFieldClientComponent = (props) => {
  const { path } = props
  const { setValue, formInitializing } = useField({ path })

  const itemPath = path.slice(0, path.lastIndexOf('.'))

  // Отримуємо вибраний продукт (у Payload у зв'язках зазвичай зберігається ID або об'єкт з ID)
  const productValue = useFormFields(
    ([fields]) => fields[`${itemPath}.product`]?.value,
  )

  const customerValue = useFormFields(
    ([fields]) => fields.customer?.value,
  )

  const productId = getRelationshipID(productValue)
  const customerID = getRelationshipID(customerValue)

  const [error, setError] = useState<string | null>(null)
  const previous = useRef({ productId, customerID })

  useEffect(() => {
    const changed =
      previous.current.productId !== productId ||
      previous.current.customerID !== customerID

    previous.current = { productId, customerID }

    if (formInitializing || !changed) {
      return
    }

    if (!productId) {
      setValue(undefined)
      setError(null)
      return
    }

    const controller = new AbortController()

    async function loadPrice() {
      setError(null)
      setValue(undefined)

      try {
        // Робимо запит за ID продукту (це стандартний і найшвидший маршрут у REST API Payload)
        const productRes = await fetch(
          `/api/products/${encodeURIComponent(String(productId))}?depth=0`,
          { credentials: 'same-origin', signal: controller.signal },
        )

        if (!productRes.ok) {
          throw new Error(`Product request failed: ${productRes.status}`)
        }

        const product = await productRes.json()
        if (!isRecord(product)) {
          throw new Error('Invalid product response')
        }

        const customer = customerID
          ? await fetch(
            `/api/users/${encodeURIComponent(customerID)}?depth=0`,
            { credentials: 'same-origin', signal: controller.signal },
          ).then(res => res.json())
          : null

        const isWholesale = isRecord(customer) && customer.wholesale === true

        const price = toPrice(
          isWholesale ? product.wholesalePrice : product.retailPrice,
        )

        if (price === null) {
          throw new Error('Product price is missing')
        }

        setValue(price)
      } catch (err) {
        if (controller.signal.aborted) {
          return
        }
        setError('Error getting price, check API')
      }
    }

    void loadPrice()

    return () => {
      controller.abort()
    }
  }, [productId, customerID, formInitializing, setValue])

  return (
    <>
      <NumberField {...props} />
      {error && (
        <p role="alert" style={{ color: 'var(--theme-error-500)' }}>
          {error}
        </p>
      )}
    </>
  )
}