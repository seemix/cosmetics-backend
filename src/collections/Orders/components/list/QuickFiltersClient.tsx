'use client'

import { useListQuery, useTranslation } from '@payloadcms/ui'
import type { Where } from 'payload'

import { customT } from '@/i18n/labels'

import {
  activeDatePreset,
  activeStatus,
  DATE_FIELD,
  DATE_PRESETS,
  dateConditions,
  hasFieldConditions,
  ORDER_STATUSES,
  replaceFieldConditions,
  STATUS_FIELD,
  statusConditions,
  type DatePreset,
  type DateRange,
  type OrderStatus,
} from './quickFilterWhere'

import './ordersList.css'

type Props = { ranges: Record<DatePreset, DateRange> }

/** Значення select: '' — без фільтра, CUSTOM — умова поля задана звичайним фільтром і не збігається з пунктом. */
const ALL = ''
const CUSTOM = '__custom'

/** Швидкі фільтри «Статус» і «Дата» в один ряд: змінюють лише свої умови, інші умови й пошук лишаються. */
export const OrdersQuickFiltersClient = ({ ranges }: Props) => {
  const { query, refineListData } = useListQuery()
  const { t: translate } = useTranslation()
  const t = customT(translate)
  const where = query?.where as Where | undefined

  const status = activeStatus(where) ?? (hasFieldConditions(where, STATUS_FIELD) ? CUSTOM : ALL)
  const preset = activeDatePreset(where, ranges) ?? (hasFieldConditions(where, DATE_FIELD) ? CUSTOM : ALL)

  const apply = (field: string, conditions: Where[]) => {
    void refineListData({ where: replaceFieldConditions(where, field, conditions), page: 1 })
  }

  return (
    <div className="orders-quick-filters">
      <label className="orders-quick-filters__field">
        <span className="orders-quick-filters__label">{t('custom:ordersList:quickStatus')}</span>
        <select
          className="orders-quick-filters__select"
          value={status}
          onChange={(event) => {
            const value = event.target.value
            apply(STATUS_FIELD, value === ALL ? [] : statusConditions(value as OrderStatus))
          }}
        >
          <option value={ALL}>{t('custom:ordersList:quickAll')}</option>
          {ORDER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`custom:status:${value}`)}
            </option>
          ))}
          {status === CUSTOM && (
            <option value={CUSTOM} disabled>
              {t('custom:ordersList:quickCustom')}
            </option>
          )}
        </select>
      </label>
      <label className="orders-quick-filters__field">
        <span className="orders-quick-filters__label">{t('custom:ordersList:quickDate')}</span>
        <select
          className="orders-quick-filters__select"
          value={preset}
          onChange={(event) => {
            const value = event.target.value
            apply(DATE_FIELD, value === ALL ? [] : dateConditions(ranges[value as DatePreset]))
          }}
        >
          <option value={ALL}>{t('custom:ordersList:quickAll')}</option>
          {DATE_PRESETS.map((value) => (
            <option key={value} value={value}>
              {t(`custom:ordersList:date:${value}`)}
            </option>
          ))}
          {preset === CUSTOM && (
            <option value={CUSTOM} disabled>
              {t('custom:ordersList:quickCustom')}
            </option>
          )}
        </select>
      </label>
    </div>
  )
}
