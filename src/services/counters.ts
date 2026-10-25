import type { PayloadRequest } from 'payload'

/**
 * Спільний лічильник номерів документів. Лежить у службовій колекції MongoDB `counters`
 * і збільшується атомарним `$inc`.
 */
export const COUNTERS_COLLECTION = 'counters'

type CounterDoc = { _id: string; value: number }

/** Початкове значення лічильника: найбільший вже використаний номер (0, якщо документів немає). */
export type CounterSeed = number | ((req: PayloadRequest) => Promise<number> | number)

/**
 * Видає наступне значення лічильника `key`. Лічильник змінюється поза транзакцією документа:
 * паралельні запити не конфліктують, а номер відкоченого документа лишається пропуском.
 * Якщо лічильника ще немає, він стартує з `seed`, тож нумерація продовжується.
 */
export const nextCounterValue = async (
  req: PayloadRequest,
  key: string,
  seed: CounterSeed = 0,
): Promise<number> => {
  const counters = req.payload.db.connection.collection<CounterDoc>(COUNTERS_COLLECTION)
  const increment = () =>
    counters.findOneAndUpdate({ _id: key }, { $inc: { value: 1 } }, { returnDocument: 'after' })

  let counter = await increment()

  if (!counter) {
    const start = typeof seed === 'function' ? await seed(req) : seed
    try {
      await counters.updateOne({ _id: key }, { $max: { value: start } }, { upsert: true })
    } catch (error) {
      // 11000: паралельний запит уже створив лічильник, $max тоді не потрібен.
      if ((error as { code?: number }).code !== 11000) throw error
    }
    counter = await increment()
  }

  if (!counter) throw new Error(`Counter "${key}" is not available`)

  return counter.value
}

/** `formatDocNumber('PUR', 1)` → `PUR-000001`. */
export const formatDocNumber = (prefix: string, value: number): string =>
  `${prefix}-${String(value).padStart(6, '0')}`
