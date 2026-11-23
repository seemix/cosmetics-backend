'use client'

import type { MouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { Box } from 'lucide-react'
import { Button, CheckboxInput, Modal, useConfig, useModal, useTranslation } from '@payloadcms/ui'

import { customT } from '@/i18n/labels'
import styles from './PickOrderButton.module.css'

export type PickItem = { product: string | null; quantity: number | null }

type ProductInfo = { title: string; article: string }

/**
 * Таблиця збірки замовлення: чекбокс на позицію, відмічена — курсив, світліша, закреслена.
 * Монтується лише поки вікно відкрите, тож стан чекбоксів не зберігається.
 */
const PickingContent = ({
  items,
  orderNumber,
  onClose,
}: {
  items: PickItem[]
  orderNumber: string
  onClose: () => void
}) => {
  const { config } = useConfig()
  const { t, i18n } = useTranslation()
  const [products, setProducts] = useState<Map<string, ProductInfo>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const ids = [...new Set(items.map((item) => item.product).filter((id): id is string => Boolean(id)))]
  const idsKey = ids.join(',')
  const language = i18n?.language
  const locale = language === 'ru' || language === 'ro' ? language : undefined

  useEffect(() => {
    if (!idsKey) {
      setLoaded(true)
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams({ depth: '0' })
    if (locale) params.set('locale', locale)

    Promise.all(
      idsKey.split(',').map(async (id) => {
        try {
          const response = await fetch(
            `${config.routes.api}/products/${encodeURIComponent(id)}?${params}`,
            { credentials: 'same-origin', signal: controller.signal },
          )
          if (!response.ok) return null
          const doc = (await response.json()) as { title?: unknown; article?: unknown }
          return {
            id,
            title: typeof doc.title === 'string' ? doc.title : '',
            article: typeof doc.article === 'string' ? doc.article : '',
          }
        } catch {
          return null
        }
      }),
    ).then((results) => {
      if (controller.signal.aborted) return
      const map = new Map<string, ProductInfo>()
      for (const result of results) {
        if (result) map.set(result.id, { title: result.title, article: result.article })
      }
      setProducts(map)
      setLoaded(true)
    })

    return () => controller.abort()
  }, [config.routes.api, idsKey, locale])

  const toggle = (index: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const tc = customT(t)

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>{tc('custom:ordersList:pickOrderTitle', { number: orderNumber })}</h2>
        <Button
          buttonStyle="subtle"
          size="small"
          icon={['x']}
          margin={false}
          aria-label={t('general:close')}
          onClick={onClose}
        />
      </div>
      {items.length === 0 ? (
        <p className={styles.empty}>{tc('custom:ordersList:pickOrderEmpty')}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkCol} />
              <th>{tc('custom:term:product')}</th>
              <th className={styles.num}>{tc('custom:term:quantity')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const info = item.product ? products.get(item.product) : undefined
              const title = !loaded
                ? '…'
                : info?.title || tc('custom:ordersList:unknownProduct')
              const done = checked.has(index)
              return (
                <tr
                  key={`${item.product ?? 'item'}-${index}`}
                  className={`${styles.row}${done ? ` ${styles.rowDone}` : ''}`}
                  onClick={() => toggle(index)}
                >
                  <td className={styles.checkCol}>
                    <span
                      className={styles.checkbox}
                      onClick={(event: MouseEvent) => event.stopPropagation()}
                    >
                      <CheckboxInput checked={done} onToggle={() => toggle(index)} />
                    </span>
                  </td>
                  <td>{info?.article ? `${info.article} | ${title}` : title}</td>
                  <td className={styles.num}>× {item.quantity ?? 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Кнопка «Зібрати замовлення» біля статусу в списку замовлень.
 * Активна, поки статус не «відправлено»; відкриває модальне вікно збірки.
 */
export const PickOrderButton = ({
  id,
  orderNumber,
  status,
  items,
  className,
}: {
  id: string
  orderNumber: string | null
  status: string
  items: PickItem[]
  className?: string
}) => {
  const { t } = useTranslation()
  const { openModal, closeModal } = useModal()
  const label = customT(t)('custom:ordersList:pickOrder')
  const slug = `order-picking-${id}`

  return (
    <>
      <Button
        buttonStyle="subtle"
        size="small"
        className={className}
        icon={<Box aria-hidden="true" strokeWidth={1.25} className={styles.boxIcon} />}
        margin={false}
        disabled={status === 'shipped'}
        aria-label={label}
        tooltip={label}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          openModal(slug)
        }}
      />
      <Modal slug={slug} className={styles.modal} closeOnBlur>
        {/* Вміст монтується лише у відкритому вікні — стан чекбоксів скидається при закритті. */}
        {(props) =>
          (props as { isOpen?: boolean }).isOpen ? (
            <PickingContent
              items={items}
              orderNumber={orderNumber ?? id}
              onClose={() => closeModal(slug)}
            />
          ) : null
        }
      </Modal>
    </>
  )
}
