# Проєкт
Headless-бекенд на Payload 3.65.0, Next.js 15, TypeScript, MongoDB.
Створено з Payload Ecommerce Template. Фронтенду немає.
Планується складський і фінансовий облік.

# Де код
Читати: payload.config.ts, src/collections, src/access, src/hooks,
src/endpoints, src/fields, src/globals, src/plugins, src/services,
src/utilities, src/email-templates, tests.
НЕ читати й не змінювати: src/assets, src/fonts, src/payload-types.ts
(генерується), src/app/(payload), node_modules, .next, lock-файли.

# Команди
- Лінтер: pnpm lint
- Типи після зміни колекцій: pnpm generate:types
- Інтеграційні тести: pnpm test:int
- Пакетний менеджер: pnpm

# Правила
- Усі виклики Payload Local API у хуках та ендпоінтах передавай з `req`.
- Рефакторинг не змінює поведінку системи.
- Одна задача = один коміт із коротким описом.
- Не додавай нових залежностей без узгодження.
- Не чіпай файли поза межами задачі.