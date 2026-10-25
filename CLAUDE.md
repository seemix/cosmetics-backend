# Проєкт
Headless-бекенд на Payload 3.65.0, Next.js 15, TypeScript, MongoDB.
Створено з Payload Ecommerce Template. Фронтенду немає.
Планується складський і фінансовий облік.

# Де код
Рішення власника лежать у docs/decisions.md.
Читати: payload.config.ts, src/collections, src/access, src/hooks, src/i18n,
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

# Багатомовність
Інтерфейс адмінки доступний англійською, російською й румунською (`en`, `ru`, `ro`);
це окремо від мов контенту товарів (`localization`). Словник: `src/i18n/` (простір `custom`,
ключ виду `custom:status:draft`), хелпери: `src/i18n/labels.ts`.
- Усі `label`, `labels` колекцій і глобалів, `options[].label` у `select`, `admin.description`
  беруться зі словника через `label()`, `collectionLabels()`, `description()`. Рядків напряму немає.
- `admin.group` не приймає функцію: `localized('custom:group:stock')`.
- Тексти помилок у хуках і `validate`: `customT(req.t)('custom:...')`.
- Тексти власних компонентів: `useTranslation()` з `@payloadcms/ui`, ключі зі словника.
- Новий ключ додається в `en.ts`, `ru.ts` і `ro.ts` одночасно: тип `CustomTranslationsObject`
  не дає пропустити ключ, а тест `tests/int/i18n.int.spec.ts` перевіряє паритет мов.
- Відсутній ключ Payload не підміняє іншою мовою, а показує сам ключ.
