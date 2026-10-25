import { describe, expect, it } from 'vitest'

import { getPromoBrandIds, isBrandEligibleForPromo } from '@/services/promo.service'

describe('promo.service', () => {
  it('промокод без брендів діє на будь-який бренд і на товар без бренду', () => {
    expect(isBrandEligibleForPromo([], 'b1')).toBe(true)
    expect(isBrandEligibleForPromo([], undefined)).toBe(true)
  })

  it('промокод з брендами діє лише на ці бренди', () => {
    expect(isBrandEligibleForPromo(['b1'], 'b1')).toBe(true)
    expect(isBrandEligibleForPromo(['b1'], 'b2')).toBe(false)
    expect(isBrandEligibleForPromo(['b1'], null)).toBe(false)
  })

  it('getPromoBrandIds приймає id і заповнені документи', () => {
    expect(getPromoBrandIds(['b1', { id: 'b2' }, null])).toEqual(['b1', 'b2'])
    expect(getPromoBrandIds(undefined)).toEqual([])
  })
})
