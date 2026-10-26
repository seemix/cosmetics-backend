'use client'

import { useEffect, useRef } from 'react'
import { useForm, useFormFields } from '@payloadcms/ui'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRelationshipID(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (isRecord(value)) return getRelationshipID(value.value ?? value.id ?? value._id)
  return null
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** Невидимий UI-компонент: при зміні клієнта підставляє його дані в блок `shippingAddress`. */
export const ShippingFromCustomer = () => {
  const { dispatchFields } = useForm()
  const customerValue = useFormFields(([fields]) => fields.customer?.value)
  const customerID = getRelationshipID(customerValue)
  const previous = useRef(customerID)

  useEffect(() => {
    if (previous.current === customerID) return
    previous.current = customerID
    if (!customerID) return

    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(String(customerID))}?depth=0`, {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!res.ok) return
        const user: unknown = await res.json()
        if (!isRecord(user)) return

        const values: Record<string, string> = {
          name: [str(user.name), str(user.surname)].filter(Boolean).join(' '),
          phone: str(user.phone),
          email: str(user.email),
          city: str(user.city),
          address: str(user.street),
        }
        for (const [key, value] of Object.entries(values)) {
          dispatchFields({ type: 'UPDATE', path: `shippingAddress.${key}`, value })
        }
      } catch {
        // Автозаповнення необов'язкове: за помилки адресу вводять вручну.
      }
    }

    void load()
    return () => controller.abort()
  }, [customerID, dispatchFields])

  return null
}
