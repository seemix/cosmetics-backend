import { dayKey, startOfDay } from '@/utilities/period'

import { datePresetRanges } from './quickFilterWhere'
import { OrdersQuickFiltersClient } from './QuickFiltersClient'

/**
 * Кнопки швидких фільтрів над таблицею замовлень. Межі днів рахуються на сервері в поясі обліку,
 * щоб «Сьогодні» означало календарний день магазину, а не браузера.
 */
export const OrdersQuickFilters = () => {
  const ranges = datePresetRanges(dayKey(new Date()), startOfDay)

  return <OrdersQuickFiltersClient ranges={ranges} />
}
