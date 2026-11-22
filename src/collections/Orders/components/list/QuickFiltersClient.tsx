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
} from './quickFilterWhere'

import './ordersList.css'

type Props = { ranges: Record<DatePreset, DateRange> }

const Chip = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    type="button"
    className={`orders-quick-filters__chip${active ? ' orders-quick-filters__chip--active' : ''}`}
    aria-pressed={active}
    onClick={onClick}
  >
    {children}
  </button>
)

/** Кнопки «Статус» і «Дата»: змінюють лише свої умови фільтра, інші умови й пошук лишаються. */
export const OrdersQuickFiltersClient = ({ ranges }: Props) => {
  const { query, refineListData } = useListQuery()
  const { t: translate } = useTranslation()
  const t = customT(translate)
  const where = query?.where as Where | undefined

  const status = activeStatus(where)
  const preset = activeDatePreset(where, ranges)

  const apply = (field: string, conditions: Where[]) => {
    void refineListData({ where: replaceFieldConditions(where, field, conditions), page: 1 })
  }

  return (
    <div className="orders-quick-filters">
      <div className="orders-quick-filters__row" role="group" aria-label={t('custom:ordersList:quickStatus')}>
        <span className="orders-quick-filters__label">{t('custom:ordersList:quickStatus')}</span>
        <Chip active={!hasFieldConditions(where, STATUS_FIELD)} onClick={() => apply(STATUS_FIELD, [])}>
          {t('custom:ordersList:quickAll')}
        </Chip>
        {ORDER_STATUSES.map((value) => (
          <Chip key={value} active={status === value} onClick={() => apply(STATUS_FIELD, statusConditions(value))}>
            {t(`custom:status:${value}`)}
          </Chip>
        ))}
      </div>
      <div className="orders-quick-filters__row" role="group" aria-label={t('custom:ordersList:quickDate')}>
        <span className="orders-quick-filters__label">{t('custom:ordersList:quickDate')}</span>
        <Chip active={!hasFieldConditions(where, DATE_FIELD)} onClick={() => apply(DATE_FIELD, [])}>
          {t('custom:ordersList:quickAll')}
        </Chip>
        {DATE_PRESETS.map((value) => (
          <Chip key={value} active={preset === value} onClick={() => apply(DATE_FIELD, dateConditions(ranges[value]))}>
            {t(`custom:ordersList:date:${value}`)}
          </Chip>
        ))}
      </div>
    </div>
  )
}
