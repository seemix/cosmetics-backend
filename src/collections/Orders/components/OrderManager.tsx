'use client'
import React, { useEffect, useRef } from 'react'
import { useForm, useWatchForm } from '@payloadcms/ui'

export const OrderManager: React.FC = () => {
  const { dispatchFields, getData } = useForm()
  const formState = useWatchForm()

  // Використовуємо ref для збереження попереднього ID клієнта
  const prevCustomerRef = useRef<string | null>(null)

  useEffect(() => {
    const syncOrder = async () => {
      const data = getData()
      const items = data?.items || []
      const customerId = data?.customer
      const currentTotal = data?.total

      // Визначаємо, чи змінився клієнт
      const isCustomerChanged = prevCustomerRef.current !== customerId
      prevCustomerRef.current = customerId

      if (!Array.isArray(items) || items.length === 0) {
        if (currentTotal !== 0) {
          ;(dispatchFields as any)({ type: 'UPDATE', path: 'total', value: 0 })
        }
        return
      }

      // 1. Отримуємо статус клієнта
      let isWholesale = false
      if (customerId) {
        try {
          const res = await fetch(`/api/users/${customerId}`)
          if (res.ok) {
            const user = await res.json()
            isWholesale = !!user?.wholesale
          }
        } catch (e) {}
      }

      let calculatedTotal = 0

      // 2. Обробка товарів
      for (let i = 0; i < items.length; i++) {
        const item = items[i]

        // Оновлюємо ціну якщо:
        // а) вона порожня
        // б) ЗМІНИВСЯ КЛІЄНТ (перераховуємо існуючі позиції під новий тип ціни)
        if (item.product && (!item.price || item.price === 0 || isCustomerChanged)) {
          try {
            const res = await fetch(`/api/products/${item.product}`)
            if (res.ok) {
              const product = await res.json()
              const targetPrice = isWholesale && product.wholesalePrice
                ? product.wholesalePrice
                : product.retailPrice

              if (targetPrice && targetPrice !== item.price) {
                ;(dispatchFields as any)({
                  type: 'UPDATE',
                  path: `items.${i}.price`,
                  value: targetPrice,
                })
                item.price = targetPrice
              }
            }
          } catch (e) {}
        }

        const quantity = Number(item.quantity) || 0
        const price = Number(item.price) || 0
        calculatedTotal += quantity * price
      }

      // 3. Оновлення total
      if (Math.abs((currentTotal || 0) - calculatedTotal) > 0.01) {
        ;(dispatchFields as any)({
          type: 'UPDATE',
          path: 'total',
          value: calculatedTotal,
        })
      }
    }

    syncOrder()
  }, [formState, dispatchFields, getData])

  return null
}