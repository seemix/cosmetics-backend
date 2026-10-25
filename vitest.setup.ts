// Any setup scripts you might need go here

// Load .env files (секрети; DATABASE_URI і зовнішні сервіси задані в vitest.config.mts)
import 'dotenv/config'
import { vi } from 'vitest'

// Запобіжник: інтеграційні тести створюють і видаляють дані, тому працюють лише з БД `*_test`.
const databaseName = /\/([^/?]+)(\?|$)/.exec(
  (process.env.DATABASE_URI ?? '').replace(/^mongodb(\+srv)?:\/\//, ''),
)?.[1]

if (!databaseName?.endsWith('_test')) {
  throw new Error(
    `Тести дозволено лише на БД з суфіксом "_test", отримано: "${databaseName ?? 'невідомо'}"`,
  )
}

// DeepL: autoTranslate у Products не має ходити в зовнішній API. Мок повертає результат
// без поля `text`, тому хук нічого не перекладає й виходить до `payload.update`.
// Без цього update у хуку (виклик без `req`, поза транзакцією створення) падає з NotFound.
vi.mock('deepl-node', () => ({
  Translator: class {
    async translateText() {
      return []
    }
  },
}))
