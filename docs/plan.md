# Аудит бекенду та план рефакторингу

Дата: 2026-10-21
Оновлено: 2026-10-24 (прийняті рішення, порядок виконання, T32, T33)
Обсяг: `src/collections`, `src/access`, `src/hooks`, `src/endpoints`, `src/fields`,
`src/globals`, `src/plugins`, `src/services`, `src/utilities`, `src/email-templates`, `tests`.
Поза обсягом (за CLAUDE.md): `src/assets`, `src/fonts`, `src/payload-types.ts`,
`src/app/(payload)`, `node_modules`, `.next`, lock-файли.

## Прийняті рішення (коротко)

Повний текст: `docs/decisions.md`. Агент не суперечить рішенням. Якщо задача залежить
від рішення зі статусом «очікує», він зупиняється й питає.

| Код | Рішення | Статус | Впливає на |
|-----|---------|--------|------------|
| D1  | Онлайн-платежів немає. Оплата готівкою або переказом на реквізити | прийнято | T14, склад і фінанси, CRM |
| D2  | Номери замовлень послідовні, з продовженням наявної нумерації | прийнято | T19 |
| D3  | Адмін бачить `wholesalePrice` | прийнято, виконано (T11) | T11 |
| D4  | Перейменувати `'discount %'` на `discountPercent` | прийнято | T32 |
| D5  | Гостьові замовлення потрібні | прийнято | `createOrder`, T14 |
| D6  | Replica set. Dev переведено, прод при деплої | прийнято, прод очікує | T12-T14 |
| D7  | Відкладено. `overrideAccess` не змінюємо під час T12-T14 | відкладено | T12-T14, T33 |
| T3  | Баг не підтвердився | знято | T3 (косметика в T24) |
| T4  | Група `prices` лишається схованою | закрито | T4 (типізація в T24) |

## Прогрес і порядок виконання до проєктування складу й фінансів

Виконано: T1, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T19, T20, T21, T26, T27, T28, T32. Частково: T2, T23 (див. примітки).
Зняті або закриті: T3, T4. Лишилося: T22, T24, T25, T29, T31, T33
плюс відкладена продуктивність T15-T18.

Кожен рядок нижче виконується окремим завданням у Cline, на зазначеній моделі.

| № | Крок | Задачі | Модель |
|---|------|--------|--------|
| 0 | Синхронізація документів | `plan.md`, `decisions.md` | Sonnet |
| 1 | Ручна перевірка на dev: кошик, промокод, створення замовлення (T8-T11 зроблено без тестів) | власник | |
| 2 | Тести на окремій тестовій БД (replica set) | T27 | Sonnet, огляд Opus |
| 3 | `req` у читальних сервісах | T12, потім T13 | Sonnet |
| 4 | `req` в Orders і захист зовнішніх викликів | T14 разом із T21 | Opus |
| 5 | Нумерація замовлень | T19 | Opus |
| 6 | Перейменування `discountPercent` з міграцією даних | T32 | Sonnet |
| 7 | Узгодження промокоду «усі бренди» | T20 | Opus |
| 8 | Аудит доступу ендпоінтів за D7 (лише читання) | T33 | Sonnet |
| 9 | Дрібниці | T22, T31 | Sonnet |

**Ворота перед проєктуванням складу й фінансів:**
1. `tsc`, лінтер і `test:int` зелені на тестовій replica set БД.
2. Гілку `refactor` змерджено в `master`, поставлено тег.
3. Прод переведено на replica set (D6) і розгорнуто зміни. Порядок: резервна копія,
   `replSetName`, `rs.initiate`, `DATABASE_URI` з `?replicaSet=rs0`, деплой.
   Окремо перевірити `bindIp` і авторизацію MongoDB на VPS.
4. T32 і T19 застосовано до прод-даних під час деплою, узгоджено з фронтендом.

Проєктування в Opus можна починати паралельно з кроками 3-7, бо воно не залежить від
коду. Реалізація складу й фінансів починається лише після воріт.

**Відкладено (не блокує новий функціонал):** T15, T16, T17, T18, T24 (разом із косметикою
з T3 і T4), T25, T29 та індекс `unavailable` із T23.

## Зафіксований стан (baseline)

`pnpm` недоступний у PATH цього середовища, тому замість `pnpm lint` використано локальні
бінарники без жодних установок:

| Перевірка          | Команда                                                          | Результат             |
|--------------------|------------------------------------------------------------------|-----------------------|
| Типи               | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 помилок             |
| Лінтер             | `node node_modules/eslint/bin/eslint.js src tests`               | 76 warnings, 0 errors |
| Інтеграційні тести | `pnpm test:int`                                                  | не запускались        |

`test:int` не запускався свідомо: він піднімає справжній Payload і пише в живу MongoDB.
Сам тест тривіальний — один `payload.find({ collection: 'users' })`, тобто як страхувальна
сітка для рефакторингу він не працює.

Розподіл 76 warnings: переважно `@typescript-eslint/no-explicit-any`,
далі `@typescript-eslint/ban-ts-comment` і `no-unused-vars`.

## Підсумок стану

Бекенд — Payload 3.65 поверх `@payloadcms/plugin-ecommerce`, де Products, Carts і Orders
задаються через `CollectionOverride`, а решта колекцій описана напряму. Структура папок (`access/`, `hooks/`,
`services/`, `endpoints/`) загалом правильна, частина логіки вже винесена
в сервіси, тож база для рефакторингу хороша. Головна системна проблема — близько 40 викликів
Local API без `req`, що прямо суперечить правилу CLAUDE.md і виводить записи за межі транзакції
запиту; при цьому сервіси приймають `payload`, а не `req`, тому це не косметична правка,
а зміна сигнатур. Друга за вагою — продуктивність: `getProductsByRelation` тягне **всі** товари
зв'язку (`limit: 0, depth: 2`) і сортує й пагінує в пам'яті, а чотири різні місця роблять
`findByID` у циклі по позиціях. Третя — контроль доступу: колекція `promo-codes` не має блоку
`access`, тобто будь-який авторизований клієнт може перелічити всі промокоди через REST.
Знайдено також тихий баг поведінки: промокод без брендів у `createOrder`
не дає знижки, хоча в `applyPromoDiscount` порожній список означає «усі бренди». (Первісне твердження, що
`req.locale as 'ru' || 'ro'` завжди дає `'ru'`, не підтвердилось
під час виконання T3: вираз компілюється в `req.locale || 'ro'`.) Транзакції **не вимкнені**: `mongooseAdapter` не має
`transactionOptions`, а закомментований
`// transactions: false` у плагіні стосується колекції transactions, а не транзакцій БД.
Дублювання суттєве: витяг product-id з позиції кошика повторюється близько восьми разів,
перевірка власника кошика — чотири рази, нормалізація кошика — три рази.

## Таблиця проблем

Серйозність: критична / висока / середня / низька.
Ризик зламати поведінку — наскільки ймовірно, що виправлення змінить видимий результат API.

| №  | Файл                                                                                                             | Проблема                                                                                                                                                                                                                 | Серйозність | Ризик зламати поведінку |
|----|------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|-------------------------|
| 1  | `src/collections/PromoCodes/index.ts`                                                                            | немає блоку `access` — будь-який авторизований користувач читає всі промокоди через `/api/promo-codes`                                                                                                                   | критична    | низький                 |
| 2  | ~40 місць у `Carts/*`, `Orders/*`, `Users/*`, `Products/*`, `endpoints/*`                                        | `payload.*` без `req`: запис поза транзакцією, втрата locale і user context; порушення правила CLAUDE.md                                                                                                                 | критична    | середній                |
| 3  | `Products/services/productsByRelation.service.ts:103`                                                            | `limit: 0, depth: 2` — усі товари зв'язку в пам'ять, сортування й пагінація вручну                                                                                                                                       | критична    | середній                |
| 4  | `Orders/hooks/setOrderNumber.ts:21`                                                                              | `padStart(4, '1026')` — некоректний pad; `find` без `req` плюс `unique: true` дає гонку при паралельних замовленнях                                                                                                      | висока      | високий                 |
| 5  | `clearCart.ts:44`, `getCartByUser.ts:58`, `fetchGuestCart.service.ts:102`, `sendNewOrderNotification.ts:36`      | `req.locale as 'ru' \|\| 'ro'` компілюється в `req.locale \|\| 'ro'`; приведення нічого не підміняє. Вада лише в неузгодженому запасному значенні (`'ro'` проти `'ru'`) і зайвому приведенні, ro-локаль працює (див. T3) | низька      | низький                 |
| 6  | `Orders/endpoints/createOrder.ts:81-90`                                                                          | промокод без брендів не застосовується, хоча в `applyPromoDiscount` порожній список означає «усі бренди»                                                                                                                 | висока      | високий                 |
| 7  | `Orders/hooks/populatePricesAndTotal.ts:37`, `Carts/hooks/priceHook.ts:26`, `createOrder.ts:57`                  | N+1: `findByID` у циклі по позиціях                                                                                                                                                                                      | висока      | низький                 |
| 8  | `Orders/services/getNormalizedOrders.ts:19`                                                                      | N+1 по товарах кожного замовлення, кеш живе лише в межах одного виклику                                                                                                                                                  | висока      | низький                 |
| 9  | `Products/hooks/relatedProducts.ts`                                                                              | `afterRead` робить запит на **кожен** документ, у тому числі в списках                                                                                                                                                   | висока      | середній                |
| 10 | `Products/hooks/autoTranslate.ts:4`                                                                              | `new deepl.Translator(...)` на рівні модуля — падіння імпорту без `DEEPL_KEY`; помилки лише в `console.error`; `update` без `req`                                                                                        | висока      | середній                |
| 11 | `Orders/hooks/sendNewOrderNotification.ts`                                                                       | axios до Telegram без `timeout`; збій `sendEmail` ковтається зовнішнім `catch`; немає retry                                                                                                                              | висока      | низький                 |
| 12 | `services/hideStockProductFields.ts:5`                                                                           | `field.type === 'group' \|\| 'name' in field && ...` — ховає `inventory` і всі групи (зараз це лише `prices`); ймовірно навмисно, повертає `any` (див. T4)                                                               | низька      | високий                 |
| 13 | `Orders/index.ts`                                                                                                | override замінює `fields` повністю, тому втрачено дефолтні поля плагіна (`customerEmail`, `transactions`) і змінено набір `status`                                                                                       | середня     | високий                 |
| 14 | `addCartItem.ts:30`, `updateCartItem.ts:33`, `removeCartItem.ts:39`, `validatePromo.ts:88`                       | перевірка власника через `cart.customer.id` під `@ts-ignore`, залежить від дефолтного `depth`                                                                                                                            | середня     | середній                |
| 15 | `Products/index.ts:79-83`                                                                                        | inline field access `req.user?.wholesale === true`; адмін без `wholesale` не бачить ціну; логіка не в `src/access`                                                                                                       | середня     | середній                |
| 16 | `Products/index.ts:100-108`                                                                                      | inline `beforeChange` для `titleWithArticle` замість окремого файлу в `hooks/`                                                                                                                                           | середня     | низький                 |
| 17 | `Carts/*`, близько восьми місць                                                                                  | дублювання витягу product-id з позиції кошика                                                                                                                                                                            | середня     | низький                 |
| 18 | `normalizedCart.ts`, `fetchGuestCart.service.ts`, `getCartByUser.ts`                                             | тричі переписана побудова `productsMap` і нормалізація кошика                                                                                                                                                            | середня     | низький                 |
| 19 | `validatePromo.ts:26` проти `cartPromoHelper.ts:7`                                                               | однаковий запит `brandDiscounts` + `wholesale` у двох місцях                                                                                                                                                             | середня     | низький                 |
| 20 | `transformProduct`, `getFavorites`, `relatedProducts`                                                            | тричі своя логіка приховування `wholesalePrice`                                                                                                                                                                          | середня     | середній                |
| 21 | `Orders/endpoints/getMyOrders.ts:11,20`                                                                          | `req.query \|\| 1` — безсенсовний вираз; `overrideAccess: true` зайвий, бо `where` вже обмежений по user                                                                                                                 | середня     | низький                 |
| 22 | `Orders/index.ts`, `Products/index.ts`, `Users/index.ts`                                                         | немає індексів на `customer`, `bestSeller`, `unavailable`, `favorites`                                                                                                                                                   | середня     | низький                 |
| 23 | `Products/index.ts`, 253 рядки                                                                                   | в одному файлі admin-конфіг, поля, inline-хуки, field access і `filterOptions`                                                                                                                                           | середня     | низький                 |
| 24 | `PromoCodes/index.ts:22-24`, `hooks/generateUniquePromo.ts`                                                      | хук закоментований — мертвий код; `defaultValue` не гарантує унікальності при `unique: true`                                                                                                                             | середня     | середній                |
| 25 | `price.service.ts`, `normalizedCart.ts`, `getOrCreateCart.ts`, `hideStockProductFields.ts`, `endpoints/types.ts` | `any` у публічних сигнатурах — тип-безпека втрачена на межах модулів                                                                                                                                                     | середня     | низький                 |
| 26 | `Categories.ts`, `Media.ts`, `Posts/index.ts`, `Pages/index.ts`, `Brands/index.ts`                               | inline `read: () => true` замість наявного `publicAccess`                                                                                                                                                                | низька      | мінімальний             |
| 27 | `Users/index.ts:24`                                                                                              | inline `checkRole(['admin'], user)` замість наявного `adminOnly`                                                                                                                                                         | низька      | мінімальний             |
| 28 | `normalizedCart.ts:34`                                                                                           | `product?.brand.id` — TypeError, якщо `brand` є null                                                                                                                                                                     | низька      | низький                 |
| 29 | `Users/endpoints/getFavorites.ts` і `getMyFavorites.ts`                                                          | перетин відповідальності, два ендпоінти на один ресурс                                                                                                                                                                   | низька      | низький                 |
| 30 | `src/endpoints/getCartByUser.ts`                                                                                 | лежить у глобальних `endpoints/`, хоча реєструється в колекції Carts                                                                                                                                                     | низька      | мінімальний             |
| 31 | `payload.config.ts:130`                                                                                          | `process.env.RESEND_API_KEY as string` — приведення замість перевірки                                                                                                                                                    | низька      | мінімальний             |

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

- [x] **T3. Виправити локаль-фолбек.** — ЗНЯТО
  Мета: прибрати `req.locale as 'ru' || 'ro'`, який завжди давав `'ru'`.
  Файли: `clearCart.ts`, `getCartByUser.ts`, `fetchGuestCart.service.ts`,
  `sendNewOrderNotification.ts`, новий `src/utilities/resolveLocale.ts`.
  Готово: при `locale=ro` повертається ro-контент, лист приходить румунською;
  `tsc` чистий.
  Складність: S. Модель: мала.
  Увага: це виправлення бага, видимий результат зміниться — узгодити з продуктом.
  ЗНЯТО (рішення власника, `docs/decisions.md`): передумова не підтвердилась. `x as 'ru' || 'ro'` компілюється в
  `x || "ro"` (перевірено через TypeScript transpile): `as` лише приведення типу і
  значення не підміняє. Тобто ro-локаль передається далі коректно, помилки
  "завжди ru" немає. Лишається косметика: зайве приведення, а в
  `sendNewOrderNotification.ts` запасне значення `'ro'` суперечить `'ru'` в інших
  місцях (проявиться, лише якщо `req.locale` порожній; Payload з `defaultLocale: 'ru'`
  зазвичай його задає). Рекомендація: перепланувати як S-чистку типів без зміни
  поведінки або зняти.
  Рішення: задачу знято. Косметика типів переходить у T24 без зміни поведінки.

- [x] **T4. Виправити `hideStockFields`.** — ЗАКРИТО, без змін
  Мета: ховати лише групу `inventory`, а не всі групи.
  Файли: `src/services/hideStockProductFields.ts`.
  Готово: сигнатура типізована як `(fields: Field[]) => Field[]`, у адмінці сховано
  тільки інвентар, інші групи видимі.
  Складність: S. Модель: мала.
  Увага: змінить вигляд адмінки — показати скриншот до і після.
  ЗАКРИТО (рішення власника, `docs/decisions.md`): передумова не підтвердилась. У плагіні `inventory` має тип `number`,
  а не `group`, тому умова `type === 'group' || name === 'inventory'` ховає саме
  інвентар плюс групи. Єдина група в `defaultCollection.fields` тут це `prices`
  (плагін додає її через `currencies`); її ховання, імовірно, навмисне, бо ціни
  ведуться полями `retailPrice`/`wholesalePrice`. Звуження умови до `inventory`
  показало б `prices` в адмінці, тобто це зміна поведінки, а не виправлення.
  Рішення потрібне від власника: чи має `prices` лишатись схованою. Без нього
  безпечна лише типізація (`any` → `Field[]`), яка вже входить до T24.
  Рішення: група `prices` лишається схованою, умову ховання не звужувати.

- [x] **T5. Прибрати мертвий код промокодів.**
  Мета: або увімкнути `generateUniquePromo`, або видалити його разом з `defaultValue`.
  Файли: `PromoCodes/index.ts`, `PromoCodes/hooks/generateUniquePromo.ts`.
  Готово: у файлі колекції немає закоментованих хуків; унікальність коду гарантована
  одним механізмом.
  Складність: S. Модель: мала.
  Виконано: видалено файл `generateUniquePromo.ts` (ніде не імпортувався) і закоментований
  хук. `defaultValue: generatePromo(5)` залишено: поведінка форми та API не змінилась.
  Унікальність гарантує `unique: true` (індекс MongoDB). Ймовірність колізії ~1/14 млн
  на пару кодів, при збігу запис відхиляється помилкою валідації, а не дублюється.

- [x] **T6. Почистити `getMyOrders`.**
  Мета: прибрати `req.query || 1` і зайвий `overrideAccess: true`.
  Файли: `Orders/endpoints/getMyOrders.ts`.
  Готово: відповідь ендпоінта ідентична поточній, пагінація працює з `?page=2`.
  Складність: S. Модель: мала.

- [x] **T7. Винести inline-хук `titleWithArticle`.**
  Мета: логіка хука живе в `hooks/`, як вимагає CLAUDE.md.
  Файли: `Products/index.ts`, новий `Products/hooks/setTitleWithArticle.ts`.
  Готово: значення поля для існуючих товарів не змінилося після повторного збереження.
  Складність: S. Модель: мала.

- [x] **T26. Перенести `getCartByUser` у Carts.**
  Мета: структура за доменом.
  Файли: `src/endpoints/getCartByUser.ts` → `Carts/endpoints/getCartByUser.ts`,
  `Carts/index.ts`.
  Готово: шлях API незмінний, імпорт оновлено, `tsc` чистий.
  Складність: XS. Модель: мала.

- [x] **T23. Додати індекси.**
  Мета: прибрати повні скани на частих фільтрах.
  Файли: `Orders/index.ts`, `Products/index.ts`, `Users/index.ts`, далі
  `pnpm generate:types`.
  Готово: `index: true` на `customer`, `bestSeller`, `unavailable`; типи згенеровані;
  `tsc` чистий.
  Складність: S. Модель: мала.
  Виконано частково за рішенням власника: індекс додано на `customer` (Orders) і
  `bestSeller` (Products). `unavailable` пропущено, бо по ньому немає `where`/`sort`
  (лише сортування в пам'яті); повернутись після задачі про `productsByRelation`.
  `Users/index.ts` не змінювався: потрібних полів там немає. Типи згенеровано,
  `payload-types.ts` не змінився.

### Етап 2. Страхувальна сітка — перед ризикованими задачами

- [x] **T27. Покрити тестами критичну логіку.**
  Мета: мати тести, які ловлять регресії в грошах і кошику.
  Файли: `tests/int/*.int.spec.ts`.
  Готово: тести на ціноутворення (`price.service`), застосування промокоду,
  створення замовлення і нормалізацію кошика проходять і ДО, і ПІСЛЯ змін.
  Складність: L. Модель: середня.
  Рекомендація: зробити до T14-T20, інакше ризиковані задачі нічим не прикриті.
  Залежить від: D6. Тести ганяти на окремій БД (наприклад, `cosmetics_test`) як replica set,
  не на dev- чи прод-даних. Перед стартом зробити ручну перевірку кошика, промокоду й замовлення (T8-T11 зроблено без тестів).
  Виконано: 71 тест у 8 файлах `tests/int`, усі зелені на `cosmetics_test` (replica set `rs0`).
  Покрито: `calculateProductPrice`, `applyPromoDiscount`, `checkPromoCode`, `normalizeCart`,
  `cartItem` хелпери, `priceHook`, `buildProductsMap`, `normalizeCartResponse`, `fetchGuestCart`,
  `createOrder` (валідація, роздріб, опт, промокод). `vitest.config.mts` задає тестову БД, а
  `vitest.setup.ts` зупиняє запуск, якщо назва БД не закінчується на `_test`; DeepL замокано.
  Тести фіксують ПОТОЧНУ поведінку, зокрема два розходження, які T27 не виправляє:
  промокод без брендів не дає знижки в `createOrder` (T20), а хук `populatePricesAndTotal`
  затирає брендову знижку оптовика в замовленні (у плані окремої задачі немає).

### Етап 3. Прибирання дублювання

- [x] **T8. Єдиний хелпер для product-id і власника кошика.**
  Мета: прибрати близько восьми дублів і всі `@ts-ignore` у Carts.
  Файли: новий `Carts/utilities/cartItem.ts`, `addCartItem.ts`, `updateCartItem.ts`,
  `removeCartItem.ts`, `clearCart.ts`, `validatePromo.ts`, `normalizedCart.ts`,
  `getCartByUser.ts`.
  Готово: жодного `@ts-ignore` у Carts; відповіді ендпоінтів байт-у-байт ті самі
  на тестовому наборі.
  Складність: M. Модель: середня.
  Виконано: хелпери `getCartItemProductId`, `getCartCustomerId`, `isCartOwnedBy`,
  `getCartProductIds`. Усі 6 `@ts-ignore` у Carts прибрано, `tsc` і eslint чисті.
  `clearCart.ts` не змінювався: у ньому немає ні витягу product-id, ні перевірки
  власника (там лишилась лише локаль, що належить T3).
  Відмінність поведінки лише в крайньому випадку `items: null`: раніше
  `cart.items.map` кидав TypeError, тепер повертається порожній список позицій.

- [x] **T9. Єдина нормалізація кошика.**
  Мета: одна реалізація `productsMap` + `normalizeCart` замість трьох.
  Файли: `normalizedCart.ts`, `fetchGuestCart.service.ts`, `getCartByUser.ts`.
  Готово: три місця викликають одну функцію, форма відповіді незмінна.
  Складність: M. Модель: середня.
  Виконано: додано `buildProductsMap(payload, productIds, { locale, depth })` у
  `normalizedCart.ts`; `normalizeCartResponse`, `fetchGuestCart` і `getCartByUser`
  викликають її. Параметри запиту збережено як було: `locale: 'all'` + `depth: 2`
  для гостьового кошика і `/me`, конкретна локаль без `depth` для решти.
  `normalizeCart` і до того був один, тепер він єдиний і для product-id (T8).

- [x] **T10. Винести вибірку wholesale-профілю.**
  Мета: один `getCustomerPricingProfile(req, userId)`.
  Файли: новий `Users/services/getPricingProfile.ts`, `validatePromo.ts`,
  `cartPromoHelper.ts`.
  Готово: один запит профілю на запрос, розраховані знижки ті самі.
  Складність: S. Модель: мала.
  Виконано: `getCustomerPricingProfile(req, userId)` повертає `{ wholesale, brandDiscounts }`;
  `validatePromo` і `cartPromoHelper` викликають його. Запит збережено як був (`find` по `users`, `depth: 0`, `select`),
  додано лише `req`. Дублювався код, а не
  запити в одному запиті: `validatePromo` і `cartPromoHelper` не викликаються разом.
  `cartPromoHelper` тепер приймає `req` замість `payload` (це потрібно для сигнатури
  з плану), тому оновлено чотири виклики: `addCartItem`, `updateCartItem`,
  `removeCartItem`, `getGuestCart`.

- [x] **T11. Єдине приховування `wholesalePrice`.**
  Мета: одне правило доступу до оптової ціни.
  Файли: новий `src/access/canReadWholesalePrice.ts`, `Products/index.ts`,
  `productsByRelation.service.ts`, `getFavorites.ts`, `relatedProducts.ts`.
  Готово: оптовий клієнт бачить ціну, роздрібний — ні; рішення щодо адміна зафіксоване.
  Складність: M. Модель: середня.
  Увага: потрібне рішення D3 (чи бачить адмін оптову ціну).
  Виконано. Рішення D3 ухвалено: адмін бачить оптову ціну незалежно від прапорця
  `wholesale`. Новий модуль дає `canReadWholesalePrice` (field access для
  `Products.wholesalePrice`) і `canUserReadWholesalePrice(user)` — предикат для
  читань через Local API, де `overrideAccess: true` і field access не діє.
  Усі чотири місця тепер викликають одне правило.
  Межа обсягу: `calculateProductPrice` далі рахує `price` за `user?.wholesale`,
  тому адмін без прапорця бачить `wholesalePrice`, але `price` у нього роздрібна.
  Зміна цього — ціноутворення, не T11.

- [x] **T28. Прибрати небезпечний доступ до `brand`.**
  Мета: `product?.brand.id` не кидає TypeError на товарі без бренду.
  Файли: `Carts/services/normalizedCart.ts`.
  Готово: товар без бренду нормалізується без помилки.
  Складність: XS. Модель: мала.
  Виконано: `product?.brand.id` замінено на `product?.brand?.id`. Для товару без
  бренду `brandId` тепер `undefined`; `applyPromoDiscount` приймає це через `brandId?`.

### Етап 4. Міграція на `req` — головне правило CLAUDE.md

- [x] **T12. Передати `req` у Carts.**
  Мета: сервіси кошика приймають `req`, а не `payload`.
  Файли: `getOrCreateCart.ts`, `normalizedCart.ts`, `fetchGuestCart.service.ts`,
  `checkPromoCode.ts`, `cartPromoHelper.ts`, `applyPromoDiscount.ts` плюс усі
  вісім ендпоінтів Carts.
  Готово: у `src/collections/Carts` немає викликів `payload.` без `req`; `tsc` чистий.
  Складність: M. Модель: середня.
  Залежить від: D6, D7. `overrideAccess` не змінювати. Розгортати на проді лише після переходу на replica set.
  Виконано (коміт `703f208`): сервіси кошика, `priceHook` і ендпоінти Carts приймають `req`
  замість `payload`; виклик `checkPromoCode` у `createOrder.ts` оновлено під нову сигнатуру.
  `applyPromoDiscount` не звертається до Local API, тому не змінювався. Тести T27 адаптовано.

- [x] **T13. Передати `req` у Users, Products, Posts, Pages, Brands і `getMenu`.**
  Мета: решта читальних викликів у контексті запиту.
  Файли: `Users/endpoints/*`, `Products/endpoints/*`, `Products/hooks/*`,
  `Posts/endpoints/*`, `Pages/endpoints/*`, `Brands/endpoints/*`,
  `src/endpoints/getMenu.ts`.
  Готово: grep `payload\.(find|findByID|create|update|delete)` не знаходить викликів
  без `req`; відповіді ендпоінтів незмінні.
  Складність: M. Модель: середня.
  Залежить від: D6, D7. Виконувати після T12.
  Виконано (коміт `591bbe9`): `req` додано в усі виклики Local API у перелічених файлах і в
  `productsByRelation.service.ts`. У `autoTranslate` після `update` відновлюється `req.locale`
  і `req.fallbackLocale`, бо `createLocalReq` змінює передану `req`. Без `req` цей `update`
  падав з `NotFound` усередині транзакції; новий тест `autoTranslate.int.spec.ts` це ловить.
  Поза обсягом лишилися `Users/hooks/ensureFirstUserIsAdmin.ts` і `src/utilities/getDocument.ts`.

- [x] **T14. Передати `req` в Orders.**
  Мета: замовлення і його побічні ефекти в одній транзакції.
  Файли: `createOrder.ts`, `setOrderNumber.ts`, `sendNewOrderNotification.ts`,
  `getNormalizedOrders.ts`.
  Готово: інтеграційний тест створення замовлення зелений; при штучній помилці
  в середині створення в БД не залишається часткових даних.
  Складність: M. Модель: велика (транзакції плюс побічні ефекти).
  Залежить від: D1 (платежів немає, поля плагіна не повертати), D5 (`createOrder` публічний),
  D6, D7. Виконувати разом із T21 (сповіщення не мають ламати створення замовлення).
  Виконано (коміт `cbd3d4c`): `req` передано в `createOrder`, `setOrderNumber` і в `update`
  `telegramMessageId` у хуку сповіщень. `createOrder` сам відкриває транзакцію перед `create`
  і комітить її після читання створеного замовлення; при помилці — відкат. Тест зі штучною
  помилкою після запису перевіряє, що замовлення не лишається в БД. `getNormalizedOrders`
  уже передавав `req`, змін не потребував. Rate limiting із D5 не робився (окрема задача).

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
  Складність: L. Модель: велика. Відкладено: оскільки недоступні товари будуть в майбутньому рахуватись по залишках на
  складах, а не через ручне поле.

### Етап 6. Ризиковані виправлення поведінки

- [x] **T19. Надійний `orderNumber`.**
  Мета: прибрати `padStart(4, '1026')` і гонку при паралельних замовленнях.
  Файли: `Orders/hooks/setOrderNumber.ts`.
  Готово: формат номера узгоджений і задокументований; одночасне створення
  кількох замовлень не падає на `unique`.
  Складність: L. Модель: велика.
  Увага: формат номерів видно клієнтам — потрібне рішення D2.
  Залежить від: D2 (послідовні номери, з продовженням наявної нумерації), D6.
  Спершу з'ясувати формат і максимальний наявний номер на копії прод-БД, нового лічильника
  стартувати з наступного. Формат у листах, Telegram і адмінці лишається сумісним зі старими номерами.
  Виконано: формат — послідовне ціле число рядком (`"1028"`), як у наявних номерах (старий
  `padStart(4, '1026')` впливав лише на перші номери в порожній БД). Лічильник — документ
  `{ _id: 'orderNumber', value }` у службовій колекції MongoDB `counters`, номер видається
  атомарним `$inc`. Якщо лічильника немає, він створюється з найбільшого наявного числового
  номера (нечислові ігноруються), тому на проді нумерація продовжиться без ручного посіву.
  Лічильник змінюється поза транзакцією замовлення: паралельні замовлення не конфліктують,
  номер відкоченого замовлення лишається пропуском. У порожній БД нумерація починається з 1.
  Копії прод-БД не було: локальні `crm` і `cosmetics` замовлень не мають. Тести: `orderNumber.int.spec.ts`.

- [x] **T20. Узгодити промокод «усі бренди».**
  Мета: однакове правило в замовленні й кошику.
  Файли: `createOrder.ts`, `applyPromoDiscount.ts` плюс спільний сервіс розрахунку.
  Готово: промокод без вказаних брендів дає однакову знижку в `/validate-promo`
  і в створеному замовленні.
  Складність: M. Модель: велика (прямий вплив на гроші).
  Спершу підтвердити баг у коді (аудит мав хибні спрацьовування T3, T4). Виконувати після T32.
  Виконано: баг підтверджено — у кошику промокод без брендів діяв на всі товари, у `createOrder`
  не діяв на жоден; також товар без бренду під «усі бренди» знижувався лише в кошику. Спільне
  правило `isBrandEligibleForPromo` і `getPromoBrandIds` у `src/services/promo.service.ts`
  використовують `applyPromoDiscount` і `createOrder`. Тест звіряє знижку й суму `/validate-promo`
  зі створеним замовленням. Не змінювалось: кошик виключає бренди з `brandDiscounts` користувача,
  замовлення — товари з персональною `discountPrice` (лише оптовики); хук `populatePricesAndTotal`.

- [x] **T21. Захистити зовнішні виклики.**
  Мета: таймаут і логування для Telegram, DeepL і пошти.
  Файли: `sendNewOrderNotification.ts`, `autoTranslate.ts`, новий
  `src/services/notifications/*`.
  Готово: збій зовнішнього сервісу не ламає створення замовлення, факт збою
  видно в логах через `req.payload.logger`.
  Складність: M. Модель: середня.
  Рекомендація: виконувати разом із T14. Перевірити, коли саме `afterChange`-хуки виконуються
  відносно коміту транзакції, щоб сповіщення не йшли для відкоченого замовлення.
  Виконано (коміт `b9b5cf8`): `src/services/notifications/` — `withTimeout` (10 с),
  `sendEmailSafely`, `callTelegram` (axios з таймаутом), `afterCommit`. Перевірено: у Payload
  `afterChange` виконується всередині операції, до `commitTransaction`. Тому `createOrder`
  відкриває чергу, хук кладе в неї сповіщення, і вони надсилаються лише після коміту.
  Для змін з адмінки (черги немає) хук працює як раніше, одразу. Збій пошти більше не
  скасовує повідомлення в Telegram. DeepL у `autoTranslate` обгорнуто таймаутом, помилки
  пишуться через `req.payload.logger`. Тести: `orderNotifications.int.spec.ts`.

- [ ] **T22. Лінива ініціалізація DeepL.**
  Мета: відсутній `DEEPL_KEY` не ламає імпорт модуля.
  Файли: `Products/hooks/autoTranslate.ts`.
  Готово: без ключа колекція працює, переклад пропускається з попередженням у лог.
  Складність: S. Модель: мала.

### Етап 6а. Задачі за прийнятими рішеннями

- [x] **T32. Перейменувати `'discount %'` на `discountPercent` (D4).**
  Мета: прибрати поле з пробілом і `%` в імені.
  Файли: колекція промокодів, усі місця коду, що читають поле, скрипт міграції даних.
  Готово: схема й типи оновлені (`generate:types`); міграція перейменувала поле в наявних
  документах (спершу резервна копія); `tsc`, лінтер і тести зелені; зміну узгоджено з фронтендом,
  якщо API віддає це поле.
  Складність: M. Модель: середня.
  Увага: breaking change. Виконувати після T27 і до T20, розгортати разом із міграцією на проді.
  Виконано: поле в `PromoCodes` перейменовано на `discountPercent` (підпис в адмінці лишився
  «Discount %»), оновлено `createOrder`, `cartPromoHelper`, `validatePromo`, фікстури тестів і
  `payload-types.ts`. Міграція Payload `src/migrations/20261024_074830_rename_promo_discount_percent.ts`
  (`$rename` в обидва боки), запуск: `pnpm payload migrate`. Відповіді `/validate-promo` і кошика
  вже віддавали ключ `discountPercent`, тому для фронтенду змінюється лише REST `promo-codes`
  (доступний тільки адміну). На проді: спершу `mongodump` колекції `promo-codes`, потім міграція
  разом із деплоєм. У dev-БД промокодів немає. Тест: `migrationDiscountPercent.int.spec.ts`.

- [ ] **T33. Аудит доступу ендпоінтів за D7.**
  Мета: підтвердити, що кожен ендпоінт, який віддає дані клієнту, має власну перевірку
  ролі чи власника, бо `overrideAccess: true` за замовчуванням.
  Файли: лише читання, результат у `docs/access-audit.md`.
  Готово: таблиця «ендпоінт | що віддає | чим захищений | висновок»; знайдені прогалини
  оформлені окремими задачами.
  Складність: S. Модель: мала.
  Увага: це аудит, код не змінювати. Після нього діє правило D7 для нового коду.

### Етап 7. Типізація і структура

- [ ] **T24. Прибрати `any` з публічних сигнатур.**
  Мета: типізовані межі модулів.
  Файли: `price.service.ts`, `normalizedCart.ts`, `getOrCreateCart.ts`,
  `endpoints/types.ts`, `getNormalizedOrders.ts`.
  Готово: кількість eslint-warnings впала з 76 до 40 або менше; `tsc` чистий.
  Складність: L — краще розбити на 2-3 підзадачі по файлах. Модель: середня.
  Сюди ж: косметика типів із T3 (зайве приведення локалі, розбіжність запасного значення
  в `sendNewOrderNotification.ts`) і типізація `hideStockProductFields.ts` із T4.
  Поведінку не змінювати.

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
Override замінює `fields` цілком, тому дефолтні поля плагіна ecommerce (`customerEmail`, `transactions`) втрачені, а
`status` має власний набір значень.
Якщо плануються онлайн-платежі, потрібно повертатися до `defaultCollection.fields`,
а це вже міграція даних наявних замовлень. Питання: чи потрібні платежі в найближчих планах?
ВИРІШЕНО: онлайн-платежів найближчим часом немає, розрахунок готівкою або переказом на реквізити.
Поля плагіна не повертаємо. Оплату в обліку моделювати як ручне підтвердження. Дата: 2026-10-23.

**D2. Формат `orderNumber`.**
`padStart(4, '1026')` дає непослідовні й непередбачувані номери. Будь-яка нова схема (наприклад, окремий лічильник)
змінить вигляд номерів у листах, Telegram і адмінці.
Питання: номери мають бути послідовними, чи достатньо унікальних?
ВИРІШЕНО: номери послідовні й продовжують наявну нумерацію (T19). Дата: 2026-10-23.

**D3. Чи має адмін бачити `wholesalePrice`.**
Поточне правило — тільки `req.user?.wholesale === true`, тому адмін без цього прапорця
оптову ціну не бачить. Питання: це навмисно або баг?
ВИРІШЕНО (T11): це баг. Адмін бачить оптову ціну незалежно від прапорця `wholesale`.
Правило живе в `src/access/canReadWholesalePrice.ts`.

**D4. Поле `'discount %'`.**
Пробіл і символ `%` в імені поля змушують звертатися через дужки й ламають
автодоповнення. Перейменування — breaking change плюс міграція даних.
Питання: чи готові перейменувати на `discountPercent` у наступному релізі?
ВИРІШЕНО: так, перейменовуємо (нова задача T32 з міграцією даних). Дата: 2026-10-23.

**D5. Гостьові замовлення.**
`createOrder` не вимагає авторизації. Якщо це навмисно, варто додати rate limiting,
бо ендпоінт пише в БД і надсилає зовнішні повідомлення. Якщо ні — закрити доступ.
Питання: гостьове оформлення — продуктова вимога?
ВИРІШЕНО: так, гостьові замовлення потрібні. Додати rate limiting і сувору валідацію (T14 або окремою задачею).
Дата: 2026-10-23.

**D6. Replica set для транзакцій.**
Транзакції в адаптері увімкнені, але на standalone MongoDB вони фактично не працюють.
Питання: прод-БД — replica set або Atlas? Від цього залежить ціна задач T12-T14.
ВИРІШЕНО: replica set. На dev уже переведено, на проді (зараз standalone) перехід під час деплою оновлень.
Зміни T12-T14 розгортати на проді не раніше за цей перехід. Дата: 2026-10-23.

**D7. `overrideAccess` у Local API.**
Payload дефолтить `overrideAccess: true` для Local API, тому передача `req` дає
транзакції й контекст, а не захист. Якщо для частини ендпоінтів потрібен саме захист
на рівні доступу, його треба додавати явно через `overrideAccess: false`.
Питання: де в проєкті така поведінка бажана?
ВІДКЛАДЕНО: під час T12-T14 передаємо `req`, `overrideAccess` не змінюємо. Правило для нового коду
(склад, фінанси, CRM): ендпоінт або явно перевіряє роль чи власника, або використовує
`overrideAccess: false` з `user`. Окрема задача T33 (аудит ендпоінтів).

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
