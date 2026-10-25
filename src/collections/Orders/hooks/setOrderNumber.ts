import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload';

import { COUNTERS_COLLECTION, nextCounterValue } from '@/services/counters';

/**
 * Номер замовлення — послідовне ціле число рядком ("1028", "1029", ...), як і раніше.
 * Лічильник лежить у службовій колекції MongoDB `counters` (див. `services/counters`).
 */
export const ORDER_COUNTERS_COLLECTION = COUNTERS_COLLECTION;
export const ORDER_COUNTER_ID = 'orderNumber';

/** Найбільший наявний числовий номер замовлення, 0 якщо замовлень немає. */
const findMaxOrderNumber = async (req: PayloadRequest): Promise<number> => {
  const { docs } = await req.payload.find({
    collection: 'orders',
    select: { orderNumber: true },
    pagination: false,
    depth: 0,
    req,
  });

  return docs.reduce((max, doc) => {
    const value = doc.orderNumber ?? '';
    return /^\d+$/.test(value) ? Math.max(max, Number(value)) : max;
  }, 0);
};

export const setOrderNumber: CollectionBeforeChangeHook = async ({ req, data, operation }) => {
  if (operation !== 'create') return data;

  // Лічильника ще немає: продовжуємо наявну нумерацію з найбільшого номера.
  data.orderNumber = String(await nextCounterValue(req, ORDER_COUNTER_ID, findMaxOrderNumber));

  return data;
};
