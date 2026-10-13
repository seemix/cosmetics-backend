
'use client'

import React, { useEffect } from 'react'
import { useAllFormFields, useForm, useWatchForm } from '@payloadcms/ui'

type OrderItem = {
  quantity?: unknown
  price?: unknown
}

type OrderData = {
  items?: unknown
  total?: unknown
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function isOrderItem(value: unknown): value is OrderItem {
  return typeof value === 'object' && value !== null
}

export const OrderManager: React.FC = () => {
  const { getData } = useForm()
  const [, dispatchFields] = useAllFormFields()
  const formState = useWatchForm()

  useEffect(() => {
    const data = getData() as OrderData | undefined

    const items = Array.isArray(data?.items)
      ? data.items.filter(isOrderItem)
      : []

    const calculatedTotal = items.reduce((sum, item) => {
      const quantity = toNumber(item.quantity)
      const price = toNumber(item.price)

      return sum + quantity * price
    }, 0)

    const currentTotal = toNumber(data?.total)

    if (
      typeof data?.total !== 'number' ||
      Math.abs(currentTotal - calculatedTotal) > 0.01
    ) {
      dispatchFields({
        type: 'UPDATE',
        path: 'total',
        value: Number(calculatedTotal.toFixed(2)),
      })
    }
  }, [formState, dispatchFields, getData])

  return null
}