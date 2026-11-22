import type { Where } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  activeDatePreset,
  activeStatus,
  datePresetRanges,
  dateConditions,
  hasFieldConditions,
  replaceFieldConditions,
  shiftDay,
  statusConditions,
} from '@/collections/Orders/components/list/quickFilterWhere'
import { startOfDay } from '@/utilities/period'

const ranges = datePresetRanges('2026-11-22', startOfDay)

describe('швидкі фільтри списку замовлень', () => {
  it('межі пресетів дати — початки днів у поясі обліку', () => {
    // Кишинів у листопаді UTC+2: 00:00 22.11 = 22:00 21.11 UTC.
    expect(ranges.today).toEqual({ from: '2026-11-21T22:00:00.000Z' })
    expect(ranges.yesterday).toEqual({ from: '2026-11-20T22:00:00.000Z', to: '2026-11-21T22:00:00.000Z' })
    expect(ranges.last7.from).toBe('2026-11-15T22:00:00.000Z')
    expect(ranges.thisMonth.from).toBe('2026-10-31T22:00:00.000Z')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('статус замінює лише свою умову й лишає інші', () => {
    const start: Where = { or: [{ and: [{ total: { greater_than: 100 } }, { status: { equals: 'paid' } }] }] }
    const next = replaceFieldConditions(start, 'status', statusConditions('pending'))

    expect(next).toEqual({ or: [{ and: [{ total: { greater_than: 100 } }, { status: { equals: 'pending' } }] }] })
    expect(activeStatus(next)).toBe('pending')
  })

  it('«Усі» знімає умову поля, порожній фільтр стає {}', () => {
    const withStatus = replaceFieldConditions(undefined, 'status', statusConditions('paid'))
    expect(hasFieldConditions(withStatus, 'status')).toBe(true)

    const cleared = replaceFieldConditions(withStatus, 'status', [])
    expect(cleared).toEqual({})
    expect(hasFieldConditions(cleared, 'status')).toBe(false)
    expect(activeStatus(cleared)).toBeNull()
  })

  it('пресет дати розпізнається за межами, статус і дата поєднуються', () => {
    let where = replaceFieldConditions(undefined, 'createdAt', dateConditions(ranges.yesterday))
    where = replaceFieldConditions(where, 'status', statusConditions('shipped'))

    expect(activeDatePreset(where, ranges)).toBe('yesterday')
    expect(activeStatus(where)).toBe('shipped')

    where = replaceFieldConditions(where, 'createdAt', dateConditions(ranges.today))
    expect(activeDatePreset(where, ranges)).toBe('today')
    expect(activeStatus(where)).toBe('shipped')
  })

  it('довільна умова дати з фільтра не підсвічує пресет', () => {
    const where: Where = { or: [{ and: [{ createdAt: { greater_than_equal: '2020-01-01T00:00:00.000Z' } }] }] }

    expect(activeDatePreset(where, ranges)).toBeNull()
    expect(hasFieldConditions(where, 'createdAt')).toBe(true)
  })

  it('кожна група «АБО» отримує умову', () => {
    const where: Where = { or: [{ and: [{ total: { equals: 1 } }] }, { and: [{ total: { equals: 2 } }] }] }

    expect(replaceFieldConditions(where, 'status', statusConditions('paid'))).toEqual({
      or: [
        { and: [{ total: { equals: 1 } }, { status: { equals: 'paid' } }] },
        { and: [{ total: { equals: 2 } }, { status: { equals: 'paid' } }] },
      ],
    })
  })
})
