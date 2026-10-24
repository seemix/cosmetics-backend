import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload';

/**
 * Номер замовлення — послідовне ціле число рядком ("1028", "1029", ...), як і раніше.
 * Лічильник лежить у службовій колекції MongoDB `counters` і збільшується атомарним `$inc`.
 */
export const ORDER_COUNTERS_COLLECTION = 'counters';
export const ORDER_COUNTER_ID = 'orderNumber';

type CounterDoc = { _id: string; value: number };

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

/**
 * Видає наступний номер. Лічильник змінюється поза транзакцією замовлення:
 * паралельні замовлення не конфліктують, а номер відкоченого замовлення лишається пропуском.
 */
const nextOrderNumber = async (req: PayloadRequest): Promise<number> => {
  const counters = req.payload.db.connection.collection<CounterDoc>(ORDER_COUNTERS_COLLECTION);
  const increment = () =>
    counters.findOneAndUpdate(
      { _id: ORDER_COUNTER_ID },
      { $inc: { value: 1 } },
      { returnDocument: 'after' },
    );

  let counter = await increment();

  if (!counter) {
    // Лічильника ще немає: продовжуємо наявну нумерацію з найбільшого номера.
    const max = await findMaxOrderNumber(req);
    try {
      await counters.updateOne({ _id: ORDER_COUNTER_ID }, { $max: { value: max } }, { upsert: true });
    } catch (error) {
      // 11000: паралельний запит уже створив лічильник, $max тоді не потрібен.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    counter = await increment();
  }

  if (!counter) throw new Error('Order number counter is not available');

  return counter.value;
};

export const setOrderNumber: CollectionBeforeChangeHook = async ({ req, data, operation }) => {
  if (operation !== 'create') return data;

  data.orderNumber = String(await nextOrderNumber(req));

  return data;
};
