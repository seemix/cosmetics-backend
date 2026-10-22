# Аудит бекенду та план рефакторингу

Дата: 2026-10-21
Обсяг: `src/collections`, `src/access`, `src/hooks`, `src/endpoints`, `src/fields`,
`src/globals`, `src/plugins`, `src/services`, `src/utilities`, `src/email-templates`, `tests`.
Поза обсягом (за CLAUDE.md): `src/assets`, `src/fonts`, `src/payload-types.ts`,
`src/app/(payload)`, `node_modules`, `.next`, lock-файли.

## Зафіксований стан (baseline)

`pnpm` недоступний у PATH цього середовища, тому замість `pnpm lint` використано локальні
бінарники без жодних установок:

| Перевірка | Команда | Результат |
|---|---|---|
| Типи | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 помилок |
| Лінтер | `node node_modules/eslint/bin/eslint.js src tests` | 76 warnings, 0 errors |
| Інтеграційні тести | `pnpm test:int` | не запускались |

`test:int` не запускався свідомо: він піднімає справжній Payload і пише в живу MongoDB.
Сам тест тривіальний — один `payload.find({ collection: 'users' })`, тобто як страхувальна
сітка для рефакторингу він не працює.

Розподіл 76 warnings: переважно `@typescript-eslint/no-explicit-any`,
далі `@typescript-eslint/ban-ts-comment` і `no-unused-vars`.

## Підсумок стану

Бекенд — Payload 3.65 поверх `@payloadcms/plugin-ecommerce`, де Products, Carts і Orders
задаються через `CollectionOverride`, а решта колекцій описана напряму. Структура папок
(`access/`, `hooks/`, `services/`, `endpoints/`) загалом правильна, частина логіки вже винесена
в сервіси, тож база для рефакторингу хороша. Головна системна проблема — близько 40 викликів
Local API без `req`, що прямо суперечить правилу CLAUDE.md і виводить записи за межі транзакції
запиту; при цьому сервіси приймають `payload`, а не `req`, тому це не косметична правка,
а зміна сигнатур. Друга за вагою — продуктивність: `getProductsByRelation` тягне **всі** товари
зв'язку (`limit: 0, depth: 2`) і сортує й пагінує в пам'яті, а чотири різні місця роблять
`findByID` у циклі по позиціях. Третя — контроль доступу: колекція `promo-codes` не має блоку
`access`, тобто будь-який авторизований клієнт може перелічити всі промокоди через REST.
Знайдено також два тихих баги поведінки: вираз `req.locale as 'ru' || 'ro'` завжди дає `'ru'`,
через що ro-листи й кошики локалізуються неправильно, і промокод без брендів у `createOrder`
не дає знижки, хоча в `applyPromoDiscount` порожній список означає «усі бренди». Транзакції
**не вимкнені**: `mongooseAdapter` не має `transactionOptions`, а закомментований
`// transactions: false` у плагіні стосується колекції transactions, а не транзакцій БД.
Дублювання суттєве: витяг product-id з позиції кошика повторюється близько восьми разів,
перевірка власника кошика — чотири рази, нормалізація кошика — три рази.

## Таблиця проблем

Серйозність: критична / висока / середня / низька.
Ризик зламати поведінку — наскільки ймовірно, що виправлення змінить видимий результат API.

| № | Файл | Проблема | Серйозність | Ризик зламати поведінку |
|---|---|---|---|---|
| 1 | `src/collections/PromoCodes/index.ts` | немає блоку `access` — будь-який авторизований користувач читає всі промокоди через `/api/promo-codes` | критична | низький |
| 2 | ~40 місць у `Carts/*`, `Orders/*`, `Users/*`, `Products/*`, `endpoints/*` | `payload.*` без `req`: запис поза транзакцією, втрата locale і user context; порушення правила CLAUDE.md | критична | середній |
| 3 | `Products/services/productsByRelation.service.ts:103` | `limit: 0, depth: 2` — усі товари зв'язку в пам'ять, сортування й пагінація вручну | критична | середній |
| 4 | `Orders/hooks/setOrderNumber.ts:21` | `padStart(4, '1026')` — некоректний pad; `find` без `req` плюс `unique: true` дає гонку при паралельних замовленнях | висока | високий |
| 5 | `clearCart.ts:44`, `getCartByUser.ts:58`, `fetchGuestCart.service.ts:102`, `sendNewOrderNotification.ts:36` | `req.locale as 'ru' \|\| 'ro'` завжди дає `'ru'` — ro-локаль не працює | висока | середній |
| 6 | `Orders/endpoints/createOrder.ts:81-90` | промокод без брендів не застосовується, хоча в `applyPromoDiscount` порожній список означає «усі бренди» | висока | високий |
| 7 | `Orders/hooks/populatePricesAndTotal.ts:37`, `Carts/hooks/priceHook.ts:26`, `createOrder.ts:57` | N+1: `findByID` у циклі по позиціях | висока | низький |
| 8 | `Orders/services/getNormalizedOrders.ts:19` | N+1 по товарах кожного замовлення, кеш живе лише в межах одного виклику | висока | низький |
| 9 | `Products/hooks/relatedProducts.ts` | `afterRead` робить запит на **кожен** документ, у тому числі в списках | висока | середній |
| 10 | `Products/hooks/autoTranslate.ts:4` | `new deepl.Translator(...)` на рівні модуля — падіння імпорту без `DEEPL_KEY`; помилки лише в `console.error`; `update` без `req` | висока | середній |
| 11 | `Orders/hooks/sendNewOrderNotification.ts` | axios до Telegram без `timeout`; збій `sendEmail` ковтається зовнішнім `catch`; немає retry | висока | низький |
| 12 | `services/hideStockProductFields.ts:5` | `field.type === 'group' \|\| 'name' in field && ...` — через пріоритет операторів ховає **всі** групи, не лише `inventory` | висока | високий |
| 13 | `Orders/index.ts` | override замінює `fields` повністю, тому втрачено дефолтні поля плагіна (`customerEmail`, `transactions`) і змінено набір `status` | середня | високий |
| 14 | `addCartItem.ts:30`, `updateCartItem.ts:33`, `removeCartItem.ts:39`, `validatePromo.ts:88` | перевірка власника через `cart.customer.id` під `@ts-ignore`, залежить від дефолтного `depth` | середня | середній |
| 15 | `Products/index.ts:79-83` | inline field access `req.user?.wholesale === true`; адмін без `wholesale` не бачить ціну; логіка не в `src/access` | середня | середній |
| 16 | `Products/index.ts:100-108` | inline `beforeChange` для `titleWithArticle` замість окремого файлу в `hooks/` | середня | низький |
| 17 | `Carts/*`, близько восьми місць | дублювання витягу product-id з позиції кошика | середня | низький |
| 18 | `normalizedCart.ts`, `fetchGuestCart.service.ts`, `getCartByUser.ts` | тричі переписана побудова `productsMap` і нормалізація кошика | середня | низький |
| 19 | `validatePromo.ts:26` проти `cartPromoHelper.ts:7` | однаковий запит `brandDiscounts` + `wholesale` у двох місцях | середня | низький |
| 20 | `transformProduct`, `getFavorites`, `relatedProducts` | тричі своя логіка приховування `wholesalePrice` | середня | середній |
| 21 | `Orders/endpoints/getMyOrders.ts:11,20` | `req.query \|\| 1` — безсенсовний вираз; `overrideAccess: true` зайвий, бо `where` вже обмежений по user | середня | низький |
| 22 | `Orders/index.ts`, `Products/index.ts`, `Users/index.ts` | немає індексів на `customer`, `bestSeller`, `unavailable`, `favorites` | середня | низький |
| 23 | `Products/index.ts`, 253 рядки | в одному файлі admin-конфіг, поля, inline-хуки, field access і `filterOptions` | середня | низький |
| 24 | `PromoCodes/index.ts:22-24`, `hooks/generateUniquePromo.ts` | хук закоментований — мертвий код; `defaultValue` не гарантує унікальності при `unique: true` | середня | середній |
| 25 | `price.service.ts`, `normalizedCart.ts`, `getOrCreateCart.ts`, `hideStockProductFields.ts`, `endpoints/types.ts` | `any` у публічних сигнатурах — тип-безпека втрачена на межах модулів | середня | низький |
| 26 | `Categories.ts`, `Media.ts`, `Posts/index.ts`, `Pages/index.ts`, `Brands/index.ts` | inline `read: () => true` замість наявного `publicAccess` | низька | мінімальний |
| 27 | `Users/index.ts:24` | inline `checkRole(['admin'], user)` замість наявного `adminOnly` | низька | мінімальний |
| 28 | `normalizedCart.ts:34` | `product?.brand.id` — TypeError, якщо `brand` є null | низька | низький |
| 29 | `Users/endpoints/getFavorites.ts` і `getMyFavorites.ts` | перетин відповідальності, два ендпоінти на один ресурс | низька | низький |
| 30 | `src/endpoints/getCartByUser.ts` | лежить у глобальних `endpoints/`, хоча реєструється в колекції Carts | низька | мінімальний |
| 31 | `payload.config.ts:130` | `process.env.RESEND_API_KEY as string` — приведення замість перевірки | низька | мінімальний |

### Пункт 9 опитувальника окремо: транзакції MongoDB

Транзакції **не вимкнені**. У `payload.config.ts` адаптер створюється як
`mongooseAdapter({ url: process.env.DATABASE_URI || '' })` — параметра `transactionOptions`
немає, тобто діє дефолт (транзакції активні). Закомментований рядок `// transactions: false`
у `src/plugins/index.ts` стосується колекції `transactions` плагіна ecommerce
(`transactions?: boolean | TransactionsConfig`), а не транзакцій бази.

Застереження: транзакції MongoDB працюють лише на replica set. На standalone-інстансі вони
тихо не застосовуються, тому користь від задач T12-T14 залежить від конфігурації прод-БД.

## Задачі рефакторингу

Задачі навмисно дрібні й незалежні: кожну можна взяти окремо, без блокування решти.
Складність: XS (до 15 хв) / S / M / L (кілька годин і потрібне ручне тестування).
«Модель» — орієнтир, яку модель варто брати: мала (механічна правка),
середня (потрібен контекст кількох файлів), велика (змінює поведінку, гроші, транзакції).

### Етап 0. Безпека — робити першою

- [x] **T1. Закрити доступ до промокодів.**
      Мета: `promo-codes` недоступні звичайним клієнтам.
      Файли: `src/collections/PromoCodes/index.ts`.
      Готово: доданий блок `access` з `read/create/update/delete: adminOnly`; валідація
      промокоду працює тільки через `/validate-promo`; запит `GET /api/promo-codes`
      від клієнта повертає 403.
      Складність: XS. Модель: мала.

### Етап 1. Дешеві незалежні чистки

- [x] **T2. Замінити inline-access на наявні хелпери.**
      Мета: один стиль контролю доступу в усіх колекціях.
      Файли: `Categories.ts`, `Media.ts`, `Posts/index.ts`, `Pages/index.ts`,
      `Brands/index.ts`, `Users/index.ts`.
      Готово: `publicAccess` і `adminOnly` імпортовані замість інлайнів, поведінка тотожна,
      `tsc --noEmit` чистий.
      Складність: XS. Модель: мала.
      Виконано частково: `publicAccess` підставлено в Categories, Media, Posts, Pages, Brands.
      `Users/index.ts` не змінено: `access.admin` приймає лише `boolean`, а `adminOnly`
      має тип `Access` (може повернути `Where`), тому `tsc` відхиляє заміну (TS2322).
      Для Users потрібен окремий хелпер з типом `boolean`; це виходить за межі T2.

- [ ] **T3. Виправити локаль-фолбек.**
      Мета: прибрати `req.locale as 'ru' || 'ro'`, який завжди давав `'ru'`.
      Файли: `clearCart.ts`, `getCartByUser.ts`, `fetchGuestCart.service.ts`,
      `sendNewOrderNotification.ts`, новий `src/utilities/resolveLocale.ts`.
      Готово: при `locale=ro` повертається ro-контент, лист приходить румунською;
      `tsc` чистий.
      Складність: S. Модель: мала.
      Увага: це виправлення бага, видимий результат зміниться — узгодити з продуктом.

- [ ] **T4. Виправити `hideStockFields`.**
      Мета: ховати лише групу `inventory`, а не всі групи.
      Файли: `src/services/hideStockProductFields.ts`.
      Готово: сигнатура типізована як `(fields: Field[]) => Field[]`, у адмінці сховано
      тільки інвентар, інші групи видимі.
      Складність: S. Модель: мала.
      Увага: змінить вигляд адмінки — показати скриншот до і після.

- [ ] **T5. Прибрати мертвий код промокодів.**
      Мета: або увімкнути `generateUniquePromo`, або видалити його разом з `defaultValue`.
      Файли: `PromoCodes/index.ts`, `PromoCodes/hooks/generateUniquePromo.ts`.
      Готово: у файлі колекції немає закоментованих хуків; унікальність коду гарантована
      одним механізмом.
      Складність: S. Модель: мала.

- [ ] **T6. Почистити `getMyOrders`.**
      Мета: прибрати `req.query || 1` і зайвий `overrideAccess: true`.
      Файли: `Orders/endpoints/getMyOrders.ts`.
      Готово: відповідь ендпоінта ідентична поточній, пагінація працює з `?page=2`.
      Складність: S. Модель: мала.

- [ ] **T7. Винести inline-хук `titleWithArticle`.**
      Мета: логіка хука живе в `hooks/`, як вимагає CLAUDE.md.
      Файли: `Products/index.ts`, новий `Products/hooks/setTitleWithArticle.ts`.
      Готово: значення поля для існуючих товарів не змінилося після повторного збереження.
      Складність: S. Модель: мала.

- [ ] **T26. Перенести `getCartByUser` у Carts.**
      Мета: структура за доменом.
      Файли: `src/endpoints/getCartByUser.ts` → `Carts/endpoints/getCartByUser.ts`,
      `Carts/index.ts`.
      Готово: шлях API незмінний, імпорт оновлено, `tsc` чистий.
      Складність: XS. Модель: мала.

- [ ] **T23. Додати індекси.**
      Мета: прибрати повні скани на частих фільтрах.
      Файли: `Orders/index.ts`, `Products/index.ts`, `Users/index.ts`, далі
      `pnpm generate:types`.
      Готово: `index: true` на `customer`, `bestSeller`, `unavailable`; типи згенеровані;
      `tsc` чистий.
      Складність: S. Модель: мала.

### Етап 2. Страхувальна сітка — перед ризикованими задачами

- [ ] **T27. Покрити тестами критичну логіку.**
      Мета: мати тести, які ловлять регресії в грошах і кошику.
      Файли: `tests/int/*.int.spec.ts`.
      Готово: тести на ціноутворення (`price.service`), застосування промокоду,
      створення замовлення і нормалізацію кошика проходять і ДО, і ПІСЛЯ змін.
      Складність: L. Модель: середня.
      Рекомендація: зробити до T14-T20, інакше ризиковані задачі нічим не прикриті.

### Етап 3. Прибирання дублювання

- [ ] **T8. Єдиний хелпер для product-id і власника кошика.**
      Мета: прибрати близько восьми дублів і всі `@ts-ignore` у Carts.
      Файли: новий `Carts/utilities/cartItem.ts`, `addCartItem.ts`, `updateCartItem.ts`,
      `removeCartItem.ts`, `clearCart.ts`, `validatePromo.ts`, `normalizedCart.ts`,
      `getCartByUser.ts`.
      Готово: жодного `@ts-ignore` у Carts; відповіді ендпоінтів байт-у-байт ті самі
      на тестовому наборі.
      Складність: M. Модель: середня.

- [ ] **T9. Єдина нормалізація кошика.**
      Мета: одна реалізація `productsMap` + `normalizeCart` замість трьох.
      Файли: `normalizedCart.ts`, `fetchGuestCart.service.ts`, `getCartByUser.ts`.
      Готово: три місця викликають одну функцію, форма відповіді незмінна.
      Складність: M. Модель: середня.

- [ ] **T10. Винести вибірку wholesale-профілю.**
      Мета: один `getCustomerPricingProfile(req, userId)`.
      Файли: новий `Users/services/getPricingProfile.ts`, `validatePromo.ts`,
      `cartPromoHelper.ts`.
      Готово: один запит профілю на запрос, розраховані знижки ті самі.
      Складність: S. Модель: мала.

- [ ] **T11. Єдине приховування `wholesalePrice`.**
      Мета: одне правило доступу до оптової ціни.
      Файли: новий `src/access/canReadWholesalePrice.ts`, `Products/index.ts`,
      `productsByRelation.service.ts`, `getFavorites.ts`, `relatedProducts.ts`.
      Готово: оптовий клієнт бачить ціну, роздрібний — ні; рішення щодо адміна зафіксоване.
      Складність: M. Модель: середня.
      Увага: потрібне рішення D3 (чи бачить адмін оптову ціну).

- [ ] **T28. Прибрати небезпечний доступ до `brand`.**
      Мета: `product?.brand.id` не кидає TypeError на товарі без бренду.
      Файли: `Carts/services/normalizedCart.ts`.
      Готово: товар без бренду нормалізується без помилки.
      Складність: XS. Модель: мала.

### Етап 4. Міграція на `req` — головне правило CLAUDE.md

- [ ] **T12. Передати `req` у Carts.**
      Мета: сервіси кошика приймають `req`, а не `payload`.
      Файли: `getOrCreateCart.ts`, `normalizedCart.ts`, `fetchGuestCart.service.ts`,
      `checkPromoCode.ts`, `cartPromoHelper.ts`, `applyPromoDiscount.ts` плюс усі
      вісім ендпоінтів Carts.
      Готово: у `src/collections/Carts` немає викликів `payload.` без `req`; `tsc` чистий.
      Складність: M. Модель: середня.

- [ ] **T13. Передати `req` у Users, Products, Posts, Pages, Brands і `getMenu`.**
      Мета: решта читальних викликів у контексті запиту.
      Файли: `Users/endpoints/*`, `Products/endpoints/*`, `Products/hooks/*`,
      `Posts/endpoints/*`, `Pages/endpoints/*`, `Brands/endpoints/*`,
      `src/endpoints/getMenu.ts`.
      Готово: grep `payload\.(find|findByID|create|update|delete)` не знаходить викликів
      без `req`; відповіді ендпоінтів незмінні.
      Складність: M. Модель: середня.

- [ ] **T14. Передати `req` в Orders.**
      Мета: замовлення і його побічні ефекти в одній транзакції.
      Файли: `createOrder.ts`, `setOrderNumber.ts`, `sendNewOrderNotification.ts`,
      `getNormalizedOrders.ts`.
      Готово: інтеграційний тест створення замовлення зелений; при штучній помилці
      в середині створення в БД не залишається часткових даних.
      Складність: M. Модель: велика (транзакції плюс побічні ефекти).

### Етап 5. Продуктивність

- [ ] **T15. Прибрати N+1 у ціноутворенні.**
      Мета: один `find({ where: { id: { in: ids } } })` замість циклу `findByID`.
      Файли: `populatePricesAndTotal.ts`, `priceHook.ts`, `createOrder.ts`.
      Готово: кількість запитів не залежить від кількості позицій; підсумкові суми
      незмінні на тестових кошиках.
      Складність: M. Модель: середня.

- [ ] **T16. Прибрати N+1 у `getNormalizedOrders`.**
      Мета: батч-вибірка товарів для всіх замовлень сторінки.
      Файли: `Orders/services/getNormalizedOrders.ts`.
      Готово: `/orders/my` робить два запити замість N; відповідь ідентична.
      Складність: M. Модель: середня.

- [ ] **T17. Обмежити `relatedProducts` afterRead.**
      Мета: хук не виконується на списках.
      Файли: `Products/hooks/relatedProducts.ts`, `Products/index.ts`.
      Готово: список товарів не робить додаткових запитів, сторінка одного товару
      віддає ті самі related.
      Складність: M. Модель: середня.
      Увага: може змінити відповідь списків — перевірити споживачів на фронті.

- [ ] **T18. Перевести `getProductsByRelation` на пагінацію в БД.**
      Мета: прибрати `limit: 0` і сортування в пам'яті.
      Файли: `Products/services/productsByRelation.service.ts`.
      Готово: пагінація і порядок (товари з `unavailable` в кінці) збігаються
      з поточними на тестовому наборі; `depth` звужено або замінено на `select`.
      Складність: L. Модель: велика.

### Етап 6. Ризиковані виправлення поведінки

- [ ] **T19. Надійний `orderNumber`.**
      Мета: прибрати `padStart(4, '1026')` і гонку при паралельних замовленнях.
      Файли: `Orders/hooks/setOrderNumber.ts`.
      Готово: формат номера узгоджений і задокументований; одночасне створення
      кількох замовлень не падає на `unique`.
      Складність: L. Модель: велика.
      Увага: формат номерів видно клієнтам — потрібне рішення D2.

- [ ] **T20. Узгодити промокод «усі бренди».**
      Мета: однакове правило в замовленні й кошику.
      Файли: `createOrder.ts`, `applyPromoDiscount.ts` плюс спільний сервіс розрахунку.
      Готово: промокод без вказаних брендів дає однакову знижку в `/validate-promo`
      і в створеному замовленні.
      Складність: M. Модель: велика (прямий вплив на гроші).

- [ ] **T21. Захистити зовнішні виклики.**
      Мета: таймаут і логування для Telegram, DeepL і пошти.
      Файли: `sendNewOrderNotification.ts`, `autoTranslate.ts`, новий
      `src/services/notifications/*`.
      Готово: збій зовнішнього сервісу не ламає створення замовлення, факт збою
      видно в логах через `req.payload.logger`.
      Складність: M. Модель: середня.

- [ ] **T22. Лінива ініціалізація DeepL.**
      Мета: відсутній `DEEPL_KEY` не ламає імпорт модуля.
      Файли: `Products/hooks/autoTranslate.ts`.
      Готово: без ключа колекція працює, переклад пропускається з попередженням у лог.
      Складність: S. Модель: мала.

### Етап 7. Типізація і структура

- [ ] **T24. Прибрати `any` з публічних сигнатур.**
      Мета: типізовані межі модулів.
      Файли: `price.service.ts`, `normalizedCart.ts`, `getOrCreateCart.ts`,
      `endpoints/types.ts`, `getNormalizedOrders.ts`.
      Готово: кількість eslint-warnings впала з 76 до 40 або менше; `tsc` чистий.
      Складність: L — краще розбити на 2-3 підзадачі по файлах. Модель: середня.

- [ ] **T25. Розділити `Products/index.ts`.**
      Мета: поля, таби й реєстрація ендпоінтів в окремих модулях.
      Файли: `Products/index.ts`, нові `Products/fields/*.ts`.
      Готово: після `pnpm generate:types` `payload-types.ts` без diff.
      Складність: L. Модель: велика.

- [ ] **T29. Звести дублювання favorites-ендпоінтів.**
      Мета: один ендпоінт замість двох з перетином відповідальності.
      Файли: `Users/endpoints/getFavorites.ts`, `Users/endpoints/getMyFavorites.ts`.
      Готово: вирішено, який шлях публічний; другий або видалений, або делегує першому.
      Складність: S. Модель: мала.
      Увага: перевірити, який шлях використовує фронт, перед видаленням.

- [ ] **T31. Перевіряти env замість приведення.**
      Мета: прибрати `as string` на `RESEND_API_KEY`.
      Файли: `src/payload.config.ts`.
      Готово: відсутній ключ дає зрозумілу помилку або явний fallback на dev-транспорт.
      Складність: XS. Модель: мала.

## Рішення для обговорення

Це не задачі — це питання, на які потрібна відповідь продукту або власника системи,
бо від неї залежить реалізація.

**D1. Поля плагіна в Orders.**
Override замінює `fields` цілком, тому дефолтні поля плагіна ecommerce
(`customerEmail`, `transactions`) втрачені, а `status` має власний набір значень.
Якщо плануються онлайн-платежі, потрібно повертатися до `defaultCollection.fields`,
а це вже міграція даних наявних замовлень. Питання: чи потрібні платежі в найближчих планах?

**D2. Формат `orderNumber`.**
`padStart(4, '1026')` дає непослідовні й непередбачувані номери. Будь-яка нова схема
(наприклад, окремий лічильник) змінить вигляд номерів у листах, Telegram і адмінці.
Питання: номери мають бути послідовними, чи достатньо унікальних?

**D3. Чи має адмін бачити `wholesalePrice`.**
Поточне правило — тільки `req.user?.wholesale === true`, тому адмін без цього прапорця
оптову ціну не бачить. Питання: це навмисно або баг?

**D4. Поле `'discount %'`.**
Пробіл і символ `%` в імені поля змушують звертатися через дужки й ламають
автодоповнення. Перейменування — breaking change плюс міграція даних.
Питання: чи готові перейменувати на `discountPercent` у наступному релізі?

**D5. Гостьові замовлення.**
`createOrder` не вимагає авторизації. Якщо це навмисно, варто додати rate limiting,
бо ендпоінт пише в БД і надсилає зовнішні повідомлення. Якщо ні — закрити доступ.
Питання: гостьове оформлення — продуктова вимога?

**D6. Replica set для транзакцій.**
Транзакції в адаптері увімкнені, але на standalone MongoDB вони фактично не працюють.
Питання: прод-БД — replica set або Atlas? Від цього залежить ціна задач T12-T14.

**D7. `overrideAccess` у Local API.**
Payload дефолтить `overrideAccess: true` для Local API, тому передача `req` дає
транзакції й контекст, а не захист. Якщо для частини ендпоінтів потрібен саме захист
на рівні доступу, його треба додавати явно через `overrideAccess: false`.
Питання: де в проєкті така поведінка бажана?

## Припущення

Зроблені під час аудиту без уточнень у користувача.

1. `pnpm lint` і `pnpm test:int` замінені на прямі виклики локальних
   `node_modules/typescript/bin/tsc` і `node_modules/eslint/bin/eslint.js`, бо `pnpm`
   немає в PATH цього середовища. Для частини правил ESLint результат рівноцінний
   `next lint`, але правила, що їх додає Next-обгортка, могли не виконатись.
2. `pnpm test:int` не запускався: потрібна жива MongoDB і тест пише в БД, що виходить
   за межі «тільки читати».
3. `src/payload-types.ts`, `src/app/(payload)`, `src/assets`, `src/fonts` не читались —
   за прямою вказівкою CLAUDE.md.
4. Гостьові замовлення й публічна реєстрація вважаються навмисною продуктовою
   поведінкою, тому не внесені як проблеми безпеки, а виведені в рішення D5.
5. Закоментований `// transactions: false` у `src/plugins/index.ts` трактується як
   опція колекції `transactions` плагіна ecommerce, а не як вимикання транзакцій БД.
6. Вважається, що клієнт фронтенду не ламається від додавання полів у відповідь, але
   ламається від перейменування чи видалення. Тому всі задачі сформульовані з критерієм
   «форма відповіді незмінна».
7. Номери рядків у таблиці відповідають стану репозиторію на дату аудиту й зсунуться
   після перших правок.
8. Порядок етапів — рекомендація, а не жорстка залежність: спершу безпека (T1), далі
   дешеві чистки, потім міграція на `req`, і найризикованіше (T18-T20) — лише після
   того, як з'явиться тестове покриття з T27.
