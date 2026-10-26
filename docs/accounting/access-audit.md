# Аудит доступу перед релізом (R3)

Дата: 2026-10-26. Гілка: `crm`. Виконано за `docs/accounting/tasks.md` (R3), `docs/accounting/design.md` (розд. 11, 13, 14), `docs/decisions.md`.

**Статус: аудит виконано, виправлення очікують.** Робочий код (колекції, ендпоінти, хуки, сервіси, конфіг) не змінювався. Додано лише цей звіт і тест `tests/int/accessAudit.int.spec.ts` з допоміжними файлами `tests/int/helpers/accessAudit*.ts` (свідоме відхилення від «лише читання» в `tasks.md`: тест лишається захистом після релізу).

## 1. Огляд

**Що перевірено.** Усі 36 колекцій і 1 глобал завантаженого конфігу, 41 ендпоінт проєкту й плагінів (ще 477 вбудованих ендпоінтів Payload покрито матрицею ресурсів), 56 викликів Local API в ендпоінтах і сервісах, які вони викликають, GraphQL, масові операції, versions/drafts, поля, mass assignment, ескалацію, канали витоку через `where`/`sort`, публічні відповіді та операційні речі (міграції, скрипти, секрети).

**Версії.** Payload 3.65.0; `@payloadcms/plugin-ecommerce`, `plugin-form-builder`, `plugin-seo` 3.65.0; `payload-sidebar-plugin` 1.3.5; vitest 3.2.3; Node v24.21.0. Поведінку дефолтного `access`, `executeAccess`, `readVersions`, порядок вибору ендпоінтів (`handleEndpoints`), валідацію `where` (`validateSearchParams`), опції `graphQL` перевірено в `node_modules/payload/dist` цієї версії, а не з пам'яті.

**Метод.** Інвентаризація автоматична (`tests/int/helpers/accessAudit.ts` читає реальний sanitized-конфіг і вихідний код), запити йдуть через `handleEndpoints` з Bearer-токенами admin / manager / customer та без токена (підхід `accessMatrix.int.spec.ts` і тестів R1). Тестова БД: `cosmetics_test` (replica set). Після повного прогону кількість документів у всіх колекціях збігається з початковою (перевірено).

**Результат прогону.** `tests/int/accessAudit.int.spec.ts`: 241 тест. З них 190 звичайних (зелені), 3 зелені контрольні в блоках знахідок, 48 тестів `it.fails` (описують правильну поведінку й «падають», доки знахідку не виправлено). `tsc --noEmit` чисто, `next lint` без помилок, повний `vitest run` 59 файлів / 896 тестів зелені.

**Застереження щодо робочої копії.** У `src/collections/Users/index.ts` лишається локальна незакомічена правка (закоментовані `cookies`); вона не потрапила й не потрапить у коміт аудиту. На перевірку прав вона не впливає, але атрибути cookie (`secure`, `SameSite`, `domain`) цим аудитом не перевірялись.

## 2. Зведення знахідок

| № | Серйозність | Суть | Тест |
|---|---|---|---|
| 1 | **Critical** | Гість при реєстрації та customer на собі встановлюють `wholesale: true` і `brandDiscounts` (до 50 %) | `[FINDING-1]` |
| 2 | **Critical** | Будь-який авторизований customer створює, змінює й видаляє бренди, категорії, сторінки, пости, файли | `[FINDING-2]` |
| 3 | **Critical** | Будь-який авторизований customer читає й видаляє `form-submissions` (персональні дані форм) | `[FINDING-3]` |
| 4 | High | Customer створює форми з довільним списком розсилки; сервер шле листи від імені `noreply@nextlevelshop.md` | `[FINDING-4]` |
| 5 | High | Будь-який авторизований розблоковує чужі акаунти (`users.unlock` без правила) | `[FINDING-5]` |
| 6 | High | Гість створює кошики, зокрема в чужого customer (товари з'являються в кошику жертви) | `[FINDING-6]` |
| 7 | High | Оракул витоку: `sort` за `accounting.cogsBani` (customer, manager) і `wholesalePrice` (гість, customer) відкриває порядок значень | `[FINDING-7]` |
| 8 | High | `createOrder` приймає від'ємну й дробову кількість; сума обнуляється, замовлення створюється | `[FINDING-8]` |
| 9 | Medium | Неопубліковані товари публічні (каталог, пошук, картка, гостьовий кошик, обране, можна замовити) | `[FINDING-9]` |
| 10 | Medium | `readVersions` не задано: customer читає історію версій товарів (чернетки, старі ціни) через REST і GraphQL | `[FINDING-10]` |
| 11 | Medium | 409 при нестачі віддає точний залишок будь-кому (питання власнику, В4) | `[FINDING-11]` |
| 12 | Medium | `products-brand` і `products-category` віддають поле `inventory`, решта ендпоінтів його виключають | `[FINDING-12]` |
| 13 | Low | Зміна email без повторної верифікації; реєстрація приймає службові поля автентифікації | `[FINDING-13]` |
| 14 | Low | Невідомий slug у `/pages`, `/brands`, `/posts` і `/…/versions` дає 500 замість 404 | `[FINDING-14]` |
| 15 | Low | Ендпоінти `plugin-seo` не перевіряють автентифікацію | `[FINDING-15]` |
| 16 | Low | `POST /carts/add-item` читає тіло раніше, ніж перевіряє автентифікацію (гість: 500 замість 401) | `[FINDING-16]` |
| 17 | Low | `remove-item` і `promo` розкривають існування чужого `cartId` (403 проти 404) | `[FINDING-17]` |
| 18 | Low | GraphQL увімкнено для внутрішніх облікових колекцій (рекомендація) | `[FINDING-18]` |

Те, що перевірено й **не** є проблемою (підтверджено тестами): `roles` і `manager` не задаються клієнтом (реєстрація, PATCH на себе, `updateUserInfo`, reset-password, GraphQL), manager не створює admin і не змінює ролі; `createOrder` ігнорує `warehouse`, `manager`, `source`, `createdBy`, `accounting.*`, `status`, `price`, `total`, `discount`, `paid*`, `customer`; `where` за закритим полем дає 400 (`QueryError`); масові PATCH/DELETE не виходять за права; облікові колекції (`stock-*`, `cash-*`, `payrolls`, `salary-schemes`…) закриті для customer, гостя й manager (окрім `warehouses`, `stock-balances` на читання та власних проведених `payrolls`); записувані кодом колекції не змінюються нікому, навіть admin; усі шість `/api/reports/*` і кеш-ендпоінти перевіряють роль першою.

## 3. Інвентаризація (згенерована з реального конфігу)

### 3.1. Колекції й глобали

Правило: назва функції, `boolean`, `defaultAccess` (дефолт Payload 3.65.0: `Boolean(user)`, пускає кожного авторизованого, зокрема customer) або «не задано». `readVersions` показано лише для колекцій з versions: **не задане правило означає «будь-який авторизований»** (`executeAccess` у 3.65.0). «inline» означає анонімну функцію в конфігу.

| slug | create | read | update | delete | інше | graphQL | hidden | versions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| users | publicAccess | readUsers | adminOrSelf | adminOnly | unlock: **defaultAccess**; admin: inline-функція | увімкнено | ні | ні |
| pages | **defaultAccess** | publicAccess | **defaultAccess** | **defaultAccess** | — | увімкнено | ні | ні |
| posts | **defaultAccess** | publicAccess | **defaultAccess** | **defaultAccess** | — | увімкнено | ні | ні |
| categories | **defaultAccess** | publicAccess | **defaultAccess** | **defaultAccess** | — | увімкнено | ні | ні |
| brands | **defaultAccess** | publicAccess | **defaultAccess** | **defaultAccess** | — | увімкнено | ні | ні |
| media | **defaultAccess** | publicAccess | **defaultAccess** | **defaultAccess** | — | увімкнено | ні | ні |
| promo-codes | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | ні | ні |
| warehouses | adminOnly | adminOrManager | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| suppliers | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| stock-moves | inline-функція | adminOnly | inline-функція | inline-функція | — | увімкнено | функція (UX) | ні |
| stock-balances | inline-функція | adminOrManager | inline-функція | inline-функція | — | увімкнено | функція (UX) | ні |
| product-costs | inline-функція | adminOnly | inline-функція | inline-функція | — | увімкнено | функція (UX) | ні |
| purchases | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| stock-transfers | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| stock-adjustments | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| opening-balances | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| cash-accounts | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| expense-categories | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| cash-moves | inline-функція | adminOnly | inline-функція | inline-функція | — | увімкнено | функція (UX) | ні |
| cash-operations | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| salary-schemes | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| payrolls | adminOnly | readPayrolls | adminOnly | adminOnly | — | увімкнено | функція (UX) | ні |
| forms | **defaultAccess** | inline-функція | **defaultAccess** | **defaultAccess** | — | увімкнено | так | ні |
| form-submissions | inline-функція | inline-функція | inline-функція | **defaultAccess** | — | увімкнено | так | ні |
| addresses | **defaultAccess** | adminOrCustomerOwner | adminOrCustomerOwner | adminOrCustomerOwner | — | увімкнено | так | ні |
| variants | adminOnly | adminOrPublishedStatus | adminOnly | adminOnly | readVersions: **не задано** | увімкнено | ні | drafts |
| variantTypes | adminOnly | publicAccess | adminOnly | adminOnly | — | увімкнено | ні | ні |
| variantOptions | adminOnly | publicAccess | adminOnly | adminOnly | — | увімкнено | ні | ні |
| products | adminOnly | inline-функція | adminOrManager | adminOnly | readVersions: **не задано** | увімкнено | ні | drafts |
| carts | publicAccess | adminOrCustomerOwner | adminOrCustomerOwner | adminOrCustomerOwner | — | увімкнено | ні | ні |
| orders | adminOrManager | inline-функція | adminOrManager | adminOnly | — | увімкнено | ні | ні |
| transactions | adminOnly | adminOnly | adminOnly | adminOnly | — | увімкнено | ні | ні |
| payload-kv | inline-функція | inline-функція | inline-функція | inline-функція | — | увімкнено | так | ні |
| payload-locked-documents | **defaultAccess** | **defaultAccess** | **defaultAccess** | **defaultAccess** | — | увімкнено | так | ні |
| payload-preferences | **defaultAccess** | preferenceAccess | **defaultAccess** | preferenceAccess | — | увімкнено | так | ні |
| payload-migrations | **defaultAccess** | **defaultAccess** | **defaultAccess** | **defaultAccess** | — | вимкнено | так | ні |
| глобал accounting-settings | — | adminOnly | adminOnly | — | — | увімкнено | функція (UX) | ні |

### 3.2. Поля з field-level access і `hidden: true`

Усього в конфігу полів з `access` — 17, і 7 полів з `hidden: true` (службові поля автентифікації Users: `hash`, `salt`, `resetPasswordToken`, `resetPasswordExpiration`, `_verificationToken`, `loginAttempts`, `lockUntil`). `hidden` ховає поле лише у відповідях, **записувати його клієнт може** (див. знахідку 13). Решта колекцій покладається лише на access колекції.

| колекція/глобал | поле | тип | field access | hidden |
| --- | --- | --- | --- | --- |
| users | wholesale | checkbox | create, update | ні |
| users | brandDiscounts | array | create, update | ні |
| users | roles | select | create, read, update | ні |
| users | manager | relationship | read, create, update | ні |
| users | resetPasswordToken | text | — | так |
| users | resetPasswordExpiration | date | — | так |
| users | salt | text | — | так |
| users | hash | text | — | так |
| users | _verified | checkbox | create, read, update | ні |
| users | _verificationToken | text | — | так |
| users | loginAttempts | number | — | так |
| users | lockUntil | date | — | так |
| cash-accounts | balanceBani | number | create, update | ні |
| forms | emails | array | read | ні |
| products | retailPrice | number | update | ні |
| products | wholesalePrice | number | read, update | ні |
| orders | items.price | number | create, update | ні |
| orders | source | select | read, create, update | ні |
| orders | warehouse | relationship | read, create, update | ні |
| orders | createdBy | relationship | read, create, update | ні |
| orders | manager | relationship | read, create, update | ні |
| orders | paidBani | number | read, create, update | ні |
| orders | paymentState | select | read, create, update | ні |
| orders | accounting | group | read, create, update | ні |

### 3.3. Ендпоінти проєкту й плагінів

Вбудовані ендпоінти Payload (CRUD, auth, upload, versions, access, count…): 477 записів, їх права визначає access колекцій (матриця розд. 4). Нижче всі, що додали проєкт і плагіни: `custom` = обробник у `src/`, `plugin` = не з `src/`.

| метод | шлях (/api…) | тип | файл обробника |
| --- | --- | --- | --- |
| GET | /menu | custom | src/endpoints/getMenu.ts |
| GET | /stock/cache-check | custom | src/endpoints/stockCacheCheck.ts |
| POST | /stock/cache-rebuild | custom | src/endpoints/stockCacheCheck.ts |
| GET | /cash/cache-check | custom | src/endpoints/cashCacheCheck.ts |
| POST | /cash/cache-rebuild | custom | src/endpoints/cashCacheCheck.ts |
| GET | /stock/product/:id | custom | src/endpoints/getProductStock.ts |
| GET | /reports/stock | custom | src/endpoints/reports/stock.ts |
| GET | /reports/purchases | custom | src/endpoints/reports/purchases.ts |
| GET | /reports/expenses | custom | src/endpoints/reports/index.ts |
| GET | /reports/profit | custom | src/endpoints/reports/profit.ts |
| GET | /reports/debts | custom | src/endpoints/reports/index.ts |
| GET | /reports/salary | custom | src/endpoints/reports/salary.ts |
| POST | /plugin-seo/generate-title | plugin | плагін (поза src) |
| POST | /plugin-seo/generate-description | plugin | плагін (поза src) |
| POST | /plugin-seo/generate-url | plugin | плагін (поза src) |
| POST | /plugin-seo/generate-image | plugin | плагін (поза src) |
| POST | /reorder | plugin | плагін (поза src) |
| POST | /users/favorites | custom | src/collections/Users/endpoints/addFavoritesItem.ts |
| GET | /users/favorites/my | custom | src/collections/Users/endpoints/getMyFavorites.ts |
| GET | /users/favorites | custom | src/collections/Users/endpoints/getFavorites.ts |
| DELETE | /users/favorites/:id | custom | src/collections/Users/endpoints/removeFavoritesItem.ts |
| PATCH | /users/update | custom | src/collections/Users/endpoints/updateUserInfo.ts |
| GET | /pages/:slug | custom | src/collections/Pages/endpoints/getPageBySlug.ts |
| GET | /posts | custom | src/collections/Posts/endpoints/getPosts.ts |
| GET | /posts/:slug | custom | src/collections/Posts/endpoints/getSinglePost.ts |
| GET | /brands/:slug | custom | src/collections/Brands/endpoints/getBrandInfo.ts |
| GET | /products/products-category/:slug | custom | src/collections/Products/endpoints/getProductsByCategory.ts |
| GET | /products/products-brand/:slug | custom | src/collections/Products/endpoints/getProductsByBrand.ts |
| GET | /products/products-search | custom | src/collections/Products/endpoints/searchProducts.ts |
| GET | /products/bestsellers | custom | src/collections/Products/endpoints/getBestSellers.ts |
| GET | /products/:identifier | custom | src/collections/Products/endpoints/getSingleProduct.ts |
| GET | /carts/me | custom | src/collections/Carts/endpoints/getCartByUser.ts |
| POST | /carts/add-item | custom | src/collections/Carts/endpoints/addCartItem.ts |
| PATCH | /carts/update-item | custom | src/collections/Carts/endpoints/updateCartItem.ts |
| POST | /carts/remove-item | custom | src/collections/Carts/endpoints/removeCartItem.ts |
| POST | /carts/clear | custom | src/collections/Carts/endpoints/clearCart.ts |
| POST | /carts/guest | custom | src/collections/Carts/endpoints/getGuestCart.ts |
| POST | /carts/merge | custom | src/collections/Carts/endpoints/mergeCart.ts |
| POST | /carts/promo | custom | src/collections/Carts/endpoints/validatePromo.ts |
| POST | /orders/create | custom | src/collections/Orders/endpoints/createOrder.ts |
| GET | /orders/my | custom | src/collections/Orders/endpoints/getMyOrders.ts |

**Порядок вибору ендпоінта.** У `handleEndpoints` (Payload 3.65.0) береться перший збіг, а власні ендпоінти колекції стоять перед стандартними. Тому `GET /api/products/:identifier` перекриває стандартні `GET /api/products/:id`, `/count` і `/versions` (список), `GET /api/posts` перекриває стандартний `find`, а `GET /api/pages/:slug`, `/brands/:slug`, `/posts/:slug` перекривають читання за id. Права цих маршрутів визначає вже не access колекції, а код обробника (Local API з обходом access, див. 3.4).

### 3.4. Виклики Local API в ендпоінтах і сервісах

Скановано 73 файлів: усі файли ендпоінтів і все, що вони транзитивно імпортують у `src/`. Знайдено 56 викликів. `overrideAccess` за замовчуванням `true`, явно `false` лише в `updateUserInfo` (з `user`). Класи: `own` — вибірка за `req.user.id`; `checked` — читання за id з тіла, власність перевіряється вручну; `public` — публічні дані, фільтр із коду або slug; `staff`/`admin` — роль перевірена першою; `service` — службовий виклик усередині хуків/сервісів; `FINDING-n` — ВРАЗЛИВИЙ.

Сканер — регулярні вирази з балансом дужок, тобто евристика: вона не бачить викликів через інші змінні, окрім `payload.*` / `req.payload.*`, і прямих запитів до Mongo (`payload.db.collections…aggregate`, їх використовують лише `stockCacheCheck`, `cashCacheCheck` та сервіси звітів за перевіркою `requireAdmin`). Усе, що сканер знайшов, класифіковано вручну; новий виклик без запису в `LOCAL_API_REVIEW` робить тест червоним.

| файл:рядок | виклик | колекція | overrideAccess | user | джерело where/data | клас |
| --- | --- | --- | --- | --- | --- | --- |
| collections/Brands/endpoints/getBrandInfo.ts:10 | find | brands | дефолт (true) | ні | where: { | public |
| collections/Carts/endpoints/addCartItem.ts:63 | update | carts | дефолт (true) | ні | data: { | own |
| collections/Carts/endpoints/clearCart.ts:19 | find | carts | дефолт (true) | ні | where: { | own |
| collections/Carts/endpoints/clearCart.ts:35 | update | carts | дефолт (true) | ні | data: { | own |
| collections/Carts/endpoints/getCartByUser.ts:18 | find | carts | дефолт (true) | ні | where: { | own |
| collections/Carts/endpoints/mergeCart.ts:38 | update | carts | дефолт (true) | ні | data: cart | own |
| collections/Carts/endpoints/removeCartItem.ts:33 | findByID | carts | дефолт (true) | ні | — | FINDING-17 |
| collections/Carts/endpoints/removeCartItem.ts:61 | update | carts | дефолт (true) | ні | data: { | own |
| collections/Carts/endpoints/updateCartItem.ts:23 | find | carts | дефолт (true) | ні | where: { | own |
| collections/Carts/endpoints/updateCartItem.ts:47 | update | carts | дефолт (true) | ні | data: { items | own |
| collections/Carts/endpoints/validatePromo.ts:72 | findByID | carts | дефолт (true) | ні | — | FINDING-17 |
| collections/Carts/services/checkPromoCode.ts:24 | find | promo-codes | дефолт (true) | ні | where: { code: { equals: promoCode.trim() | public |
| collections/Carts/services/getOrCreateCart.ts:7 | find | carts | дефолт (true) | ні | where: { | own |
| collections/Carts/services/getOrCreateCart.ts:20 | create | carts | дефолт (true) | ні | data: { | own |
| collections/Carts/services/normalizedCart.ts:59 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Orders/endpoints/createOrder.ts:59 | findByID | products | дефолт (true) | ні | — | FINDING-9 |
| collections/Orders/endpoints/createOrder.ts:120 | create | orders | дефолт (true) | ні | data: { | service |
| collections/Orders/endpoints/createOrder.ts:139 | findByID | orders | дефолт (true) | ні | — | service |
| collections/Orders/endpoints/getMyOrders.ts:12 | find | orders | дефолт (true) | ні | where: { customer: { equals: req.user.id | own |
| collections/Orders/services/getNormalizedOrders.ts:19 | findByID | products | дефолт (true) | ні | — | own |
| collections/Pages/endpoints/getPageBySlug.ts:10 | find | pages | дефолт (true) | ні | where: { | public |
| collections/Posts/endpoints/getPosts.ts:13 | find | posts | дефолт (true) | ні | — | public |
| collections/Posts/endpoints/getSinglePost.ts:10 | find | posts | дефолт (true) | ні | where: { | public |
| collections/Products/endpoints/getBestSellers.ts:9 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Products/endpoints/getSingleProduct.ts:17 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Products/endpoints/searchProducts.ts:41 | find | brands | дефолт (true) | ні | where: { | public |
| collections/Products/endpoints/searchProducts.ts:53 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Products/services/productsByRelation.service.ts:19 | findGlobal | accounting-settings | дефолт (true) | ні | — | service |
| collections/Products/services/productsByRelation.service.ts:23 | find | stock-balances | дефолт (true) | ні | where: { | service |
| collections/Products/services/productsByRelation.service.ts:115 | find | (змінна) | дефолт (true) | ні | where: { slug: { equals: slug | public |
| collections/Products/services/productsByRelation.service.ts:130 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Users/endpoints/addFavoritesItem.ts:15 | update | users | дефолт (true) | ні | data: { | own |
| collections/Users/endpoints/getFavorites.ts:10 | findByID | users | дефолт (true) | ні | — | own |
| collections/Users/endpoints/getFavorites.ts:19 | find | products | дефолт (true) | ні | where: { | FINDING-9 |
| collections/Users/endpoints/getMyFavorites.ts:9 | findByID | users | дефолт (true) | ні | — | own |
| collections/Users/endpoints/removeFavoritesItem.ts:16 | update | users | дефолт (true) | ні | data: { | own |
| collections/Users/endpoints/updateUserInfo.ts:28 | update | users | false | так | data: dataToUpdate | enforced |
| collections/Users/services/getPricingProfile.ts:17 | find | users | дефолт (true) | ні | where: { id: { equals: userId | own |
| endpoints/cashCacheCheck.ts:182 | update | cash-accounts | дефолт (true) | ні | data: { balanceBani: item.expected | admin |
| endpoints/getMenu.ts:10 | find | categories | дефолт (true) | ні | — | public |
| endpoints/getMenu.ts:21 | find | brands | дефолт (true) | ні | — | public |
| endpoints/getProductStock.ts:37 | findByID | products | дефолт (true) | ні | — | staff |
| endpoints/getProductStock.ts:48 | find | stock-balances | дефолт (true) | ні | where: { product: { equals: id | staff |
| endpoints/getProductStock.ts:57 | find | product-costs | дефолт (true) | ні | where: { product: { equals: id | staff |
| endpoints/stockCacheCheck.ts:64 | find | stock-balances | дефолт (true) | ні | — | admin |
| endpoints/stockCacheCheck.ts:65 | find | product-costs | дефолт (true) | ні | — | admin |
| endpoints/stockCacheCheck.ts:123 | find | stock-balances | дефолт (true) | ні | where: { product: { equals: item.product | admin |
| endpoints/stockCacheCheck.ts:132 | update | stock-balances | дефолт (true) | ні | data: { qty: item.expectedQty | admin |
| endpoints/stockCacheCheck.ts:140 | create | stock-balances | дефолт (true) | ні | data: { product: item.product | admin |
| endpoints/stockCacheCheck.ts:150 | find | product-costs | дефолт (true) | ні | where: { product: { equals: item.product | admin |
| endpoints/stockCacheCheck.ts:160 | update | product-costs | дефолт (true) | ні | — | admin |
| endpoints/stockCacheCheck.ts:162 | create | product-costs | дефолт (true) | ні | data: { product: item.product | admin |
| services/documents/documentLifecycle.ts:89 | findGlobal | accounting-settings | дефолт (true) | ні | — | service |
| services/documents/documentLifecycle.ts:165 | count | (змінна) | дефолт (true) | ні | where: { id: { exists: false | service |
| services/documents/documentLifecycle.ts:230 | findByID | (змінна) | дефолт (true) | ні | — | service |
| services/reports/common.ts:53 | findGlobal | accounting-settings | дефолт (true) | ні | — | admin |

## 4. Головна таблиця «ресурс → перевірка → тест»

Назви тестів — це `describe › it` у `tests/int/accessAudit.int.spec.ts` (якщо не вказано інше). Літери: A — admin, M — manager, C — customer, G — гість; мала літера — «лише своє» (перевіряється окремо на реальних документах у B2).

### 4.1. Явність і матриця ресурсів (A, B)

| Ресурс | Перевірка | Тест |
|---|---|---|
| Усі колекції й глобали | жодна не покладається на дефолтний access без позначки (allowlist із причинами, окремо — знахідки) | `A. явність access` › «жодна колекція чи глобал не покладається на дефолтний access…», «кожен виняток обґрунтований…», «знахідки з дефолтним access… досі актуальні» |
| Усі колекції й глобали | повнота: новий slug без запису в таблиці очікувань = червоний тест | `A. явність access` › «кожна колекція й глобал конфігу є в таблицях очікувань і навпаки» |
| `Users.access.admin` | пускає лише admin і manager (`admin.hidden` лише UX і як захист не зараховано) | `A. явність access` › «Users.access.admin пускає лише admin і manager…» |
| users | create: AMCG; read: AMC; update: Amc; delete: A. розд. 11: реєстрація публічна, manager створює клієнтів; читання й зміна лише себе (manager читає ще й клієнтів); видаляє admin | `B. матриця ресурсів` › «users: …» |
| pages | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-2], update/customer: [FINDING-2], delete/customer: [FINDING-2]. контент сайту: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager | `B. матриця ресурсів` › «pages: …» |
| posts | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-2], update/customer: [FINDING-2], delete/customer: [FINDING-2]. контент сайту: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager | `B. матриця ресурсів` › «posts: …» |
| categories | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-2], update/customer: [FINDING-2], delete/customer: [FINDING-2]. каталог: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager | `B. матриця ресурсів` › «categories: …» |
| brands | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-2], update/customer: [FINDING-2], delete/customer: [FINDING-2]. каталог: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager | `B. матриця ресурсів` › «brands: …» |
| media | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-2], update/customer: [FINDING-2], delete/customer: [FINDING-2]. файли: читають усі; завантаження admin і manager (адмінка); питання власнику Q2 щодо manager | `B. матриця ресурсів` › «media: …» |
| promo-codes | create: A; read: A; update: A; delete: A. промокоди бачить лише admin; клієнт перевіряє код через /api/carts/promo | `B. матриця ресурсів` › «promo-codes: …» |
| warehouses | create: A; read: AM; update: A; delete: A. M1: manager читає склади (вибір складу в замовленні), запис admin | `B. матриця ресурсів` › «warehouses: …» |
| suppliers | create: A; read: A; update: A; delete: A. розд. 11: довідник лише admin | `B. матриця ресурсів` › «suppliers: …» |
| stock-moves | create: нікому; read: A; update: нікому; delete: нікому. журнал пише лише код; читає admin (містить вартість) | `B. матриця ресурсів` › «stock-moves: …» |
| stock-balances | create: нікому; read: AM; update: нікому; delete: нікому. кеш пише лише код; manager бачить кількість (В11) | `B. матриця ресурсів` › «stock-balances: …» |
| product-costs | create: нікому; read: A; update: нікому; delete: нікому. кеш пише лише код; собівартість лише admin | `B. матриця ресурсів` › «product-costs: …» |
| purchases | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «purchases: …» |
| stock-transfers | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «stock-transfers: …» |
| stock-adjustments | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «stock-adjustments: …» |
| opening-balances | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «opening-balances: …» |
| cash-accounts | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «cash-accounts: …» |
| expense-categories | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «expense-categories: …» |
| cash-moves | create: нікому; read: A; update: нікому; delete: нікому. журнал пише лише код | `B. матриця ресурсів` › «cash-moves: …» |
| cash-operations | create: A; read: A; update: A; delete: A. розд. 11 | `B. матриця ресурсів` › «cash-operations: …» |
| salary-schemes | create: A; read: A; update: A; delete: A. розд. 11, В12: схеми менеджеру недоступні | `B. матриця ресурсів` › «salary-schemes: …» |
| payrolls | create: A; read: AM; update: A; delete: A. В12: manager читає лише свої проведені розрахунки (B2), решту admin | `B. матриця ресурсів` › «payrolls: …» |
| forms | create: AM; read: AMCG; update: AM; delete: AM. **Відхилення:** create/customer: [FINDING-4], update/customer: [FINDING-4], delete/customer: [FINDING-4]. плагін form-builder: форми читають усі (відображення на сайті); запис admin і manager; питання власнику Q2/Q3 | `B. матриця ресурсів` › «forms: …» |
| form-submissions | create: AMCG; read: AM; update: нікому; delete: AM. **Відхилення:** read/customer: [FINDING-3], delete/customer: [FINDING-3]. плагін form-builder: відправляти форму може будь-хто; читати й видаляти відправлення має лише персонал (персональні дані) | `B. матриця ресурсів` › «form-submissions: …» |
| addresses | create: AMC; read: AMC; update: Amc; delete: Amc. плагін ecommerce: адреси своїх клієнтів (adminOrCustomerOwner) | `B. матриця ресурсів` › «addresses: …» |
| variants | create: A; read: AMCG; update: A; delete: A. плагін ecommerce: варіанти не використовуються (П3), читання як у товарів | `B. матриця ресурсів` › «variants: …» |
| variantTypes | create: A; read: AMCG; update: A; delete: A. плагін ecommerce | `B. матриця ресурсів` › «variantTypes: …» |
| variantOptions | create: A; read: AMCG; update: A; delete: A. плагін ecommerce | `B. матриця ресурсів` › «variantOptions: …» |
| products | create: A; read: AMCG; update: AM; delete: A. розд. 11, В8: manager редагує описові поля й зберігає чернетку; create/delete лише admin | `B. матриця ресурсів` › «products: …» |
| carts | create: AMC; read: AMC; update: Amc; delete: Amc. **Відхилення:** create/guest: [FINDING-6]. кошик належить авторизованому користувачеві (гостьовий кошик живе в браузері: /api/carts/guest) | `B. матриця ресурсів` › «carts: …» |
| orders | create: AM; read: AMC; update: AM; delete: A. розд. 11: клієнт створює лише через /api/orders/create; читає свої (B2); update manager обмежує guardManagerOrderUpdate | `B. матриця ресурсів` › «orders: …» |
| transactions | create: A; read: A; update: A; delete: A. плагін ecommerce: онлайн-платежів немає (D1) | `B. матриця ресурсів` › «transactions: …» |
| payload-kv | create: нікому; read: нікому; update: нікому; delete: нікому. системна: сховище ключ-значення Payload, доступ нікому | `B. матриця ресурсів` › «payload-kv: …» |
| payload-locked-documents | create: AMC; read: AMC; update: AMC; delete: AMC. системна: блокування документів в адмінці; керує сам Payload (див. DEFAULT_ACCESS_ALLOWLIST) | `B. матриця ресурсів` › «payload-locked-documents: …» |
| payload-preferences | create: AMC; read: AMC; update: AMC; delete: AMC. системна: налаштування інтерфейсу користувача; доступ лише до своїх записів (preferenceAccess) | `B. матриця ресурсів` › «payload-preferences: …» |
| payload-migrations | create: нікому; read: нікому; update: нікому; delete: нікому. системна: REST вимкнено (501), graphQL вимкнено | `B. матриця ресурсів` › «payload-migrations: …» |
| глобал accounting-settings | read: A; update: A. M1: налаштування обліку лише admin | `B. матриця ресурсів` › «глобал accounting-settings: …» |
| `stock-moves`, `stock-balances`, `product-costs`, `cash-moves` | POST/PATCH/DELETE (одиночні й за `where`) заборонені всім, включно з admin | `B. матриця ресурсів` › «записувані кодом колекції…» |

### 4.2. Власні й чужі документи (B2)

| Ресурс | Перевірка | Тест |
|---|---|---|
| orders | customer читає лише свої; чужий і неіснуючий id дають однакову відповідь; список лише власні; гість нічого | `B2` › «orders: customer читає лише свої…» |
| orders | customer не змінює й не видаляє навіть своє; manager не видаляє | `B2` › «orders: customer не змінює й не видаляє…» |
| orders | manager бачить усі (В9) | `B2` › «orders: manager бачить усі замовлення (В9)» |
| users | customer читає лише себе; чужий = неіснуючий; перебір за email не відрізняється від неіснуючого | `B2` › «users: customer читає лише себе…» |
| users | manager читає себе й клієнтів, не admin і не інших manager | `B2` › «users: manager читає себе й клієнтів…» |
| users | update/delete чужого заборонені customer і manager | `B2` › «users: update і delete чужого користувача…» |
| carts | власник читає, чужий 404, зміна й видалення чужого заборонені | `B2` › «carts: власник читає…» |
| payrolls | manager бачить лише свої проведені (В12); чернетки, чужі й схеми недоступні, відповідь як для неіснуючого | `B2` › «payrolls (В12)…» |

### 4.3. Поля (C)

| Ресурс | Перевірка | Тест |
|---|---|---|
| orders (customer) | на глибині 0/1/3 немає `accounting`, `manager`, `createdBy`, `source`, `warehouse`, `roles`, `hash`, `salt` | `C. поля: читання` › «customer: власне замовлення…» |
| users (customer) | профіль без `roles`, `manager`; join `orders` не повертає `accounting`; `/users/me` без секретів автентифікації | `C. поля: читання` › «customer: свій профіль…» |
| orders, users (manager) | без `accounting.*` на будь-якій глибині; клієнти без `roles` | `C. поля: читання` › «manager: замовлення без accounting…» |
| orders.manager (manager) | знімок чужого manager не розкривається як документ | `C. поля: читання` › «manager: чужий manager у знімку…» |
| product-costs, stock-moves, cash-moves, salary-schemes, `/stock/product/:id` (manager) | 403; ендпоінт віддає лише `productId`, `warehouses`, `totalQty` | `C. поля: читання` › «manager: собівартість недоступна…» |
| payrolls (manager) | свій проведений payroll на глибині 3 без `roles`, `hash`, `salt` | `C. поля: читання` › «manager: свій проведений payroll…» |
| products.wholesalePrice | admin, manager (список), оптовик бачать; роздрібний customer і гість ні; у публічному одиночному ендпоінті лише admin і оптовик | `C. поля: читання` › «wholesalePrice: admin, manager і оптовик…» |
| products.wholesalePrice | не просочується через підвантаження (замовлення depth 4, список depth 4) | `C. поля: читання` › «wholesalePrice не просочується…» |
| products.retailPrice, wholesalePrice | manager не змінює (зберігає чернетку з описовими полями) | `C. поля: запис` › «manager не записує retailPrice і wholesalePrice…» |
| orders.items.price | manager не задає ціну позиції | `C. поля: запис` › «manager не задає ціну позиції…» |
| orders.manager, createdBy, source | manager не підробляє знімок, автора, джерело | `C. поля: запис` › «manager не підробляє знімок менеджера…» |
| users.roles, manager, wholesale, brandDiscounts (manager) | manager створює клієнта лише з `roles=[customer]`, `manager`=він сам, без wholesale і знижок | `C. поля: запис` › «manager створює клієнта лише з roles = [customer]…» |

### 4.4. Mass assignment (F) і ескалація (G)

| Ресурс | Перевірка | Тест |
|---|---|---|
| Реєстрація | `roles`, `manager`, `_verified`, `_verificationToken`, `hash`, `salt` ігноруються. **`wholesale`, `brandDiscounts`, `resetPasswordToken`, `lockUntil`, `loginAttempts` приймаються (знахідки 1, 13)** | `F. mass assignment` › «реєстрація гостя ігнорує roles…»; `[FINDING-1]`, `[FINDING-13]` |
| Реєстрація | відповідь без `roles`, `manager`, токенів, `hash`, `salt` | `F` › «відповідь на реєстрацію не містить…» |
| `PATCH /users/:id` на себе | `roles`, `manager` не змінюються; **`wholesale`, `brandDiscounts` змінюються (знахідка 1)** | `F` › «customer PATCH на себе не змінює roles і manager»; `[FINDING-1]` |
| `PATCH /users/update` | білий список; `roles`, `manager`, `wholesale`, `brandDiscounts`, `email`, `_verified` не змінюються | `F` › «updateUserInfo: білий список полів…» |
| `POST /orders/create` (гість, customer, customer з manager) | ігнорує `warehouse`, `manager`, `source`, `createdBy`, `accounting.*`, `status`, `price`, `total`, `discount`, `paid*`, `customer`, `orderNumber`, `telegramMessageId`; перевірено збережене в БД | `F` › «createOrder (гість і customer) ігнорує…» |
| `POST /orders/create` | відповідь лише `success`, `order{id, orderNumber, items}` | `F` › «createOrder: відповідь містить лише id, номер і позиції…» |
| `POST /carts/merge` | тіло не змінює власника кошика | `F` › «carts/merge: тіло не змінює власника кошика…» |
| forgot/reset-password | не змінюють `roles`, `wholesale`, `manager`; токен не повертається у відповіді | `G` › «forgot-password і reset-password не змінюють…» |
| forgot-password | однакова відповідь для наявного й неіснуючого email | `G` › «forgot-password відповідає однаково…» |
| manager | не змінює власні й чужі ролі | `G` › «manager не змінює власні й чужі ролі» |
| manager | не створює admin і manager (`roles` примусово `[customer]`) | `G` › «manager не створює admin і manager…» |
| `POST /users/:id/duplicate` | гість, customer, manager не клонують admin/manager; копія клієнта не успадковує wholesale | `G` › «duplicate…» |
| `POST /users/first-register` | закритий, коли користувачі вже є | `G` › «first-register закритий…» |

### 4.5. Канали витоку через запити (H) і масові операції (I)

| Ресурс | Перевірка | Тест |
|---|---|---|
| orders, users, products | `where` за закритим полем дає 400 `QueryError` для customer, manager, гостя (14 комбінацій) | `H` › «%s: %s?%s відхиляється…» |
| orders (customer, manager), products (гість, customer) | `sort` за закритим полем **не** повинен відкривати порядок значень. **Відкриває (знахідка 7)** | `[FINDING-7]` |
| count | із забороненим полем 400; без `where` лише доступне; гість 403 | `H` › «count: …» |
| orders | чужий номер замовлення не відрізняється від неіснуючого | `H` › «перебір чужих записів через where…» |
| find-distinct | у 3.65.0 недоступний через REST | `H` › «find-distinct…» |
| orders | `depth=3&limit=0` не додає документів без доступу | `H` › «документи без доступу не потрапляють у списки…» |
| users | `PATCH /users?where` зачіпає лише себе | `I` › «customer: PATCH /users?where…» |
| 9 закритих колекцій | масові DELETE/PATCH за `where` заборонені гостю й customer | `I` › «масові DELETE і PATCH за where заборонені…» |
| carts | масове видалення зачіпає лише власні | `I` › «customer: масове видалення кошиків…» |
| orders | manager не скасовує й не видаляє масово (В5, В9) | `I` › «manager: масове скасування й видалення замовлень не проходить» |
| products | manager не змінює ціни масово без чернетки | `I` › «manager: масова зміна товарів без чернетки відхиляється…» |
| products drafts/versions | `?draft=true` не віддає чернеток; гість не читає versions; restore заборонено | `I` › «drafts: …» |
| products versions | **customer читає versions (знахідка 10)** | `[FINDING-10]` |
| versions колекцій без versions | відповідь 500 без деталей реалізації (тіло загальне) | `I` › «versions: колекції без версій…», `[FINDING-14]` |

### 4.6. Ендпоінти (D, L)

Таблиця очікувань у `tests/int/helpers/accessAuditTables.ts` (`ENDPOINTS`). Тест повноти падає, якщо знайдено ендпоінт без запису. Для кожного запису: статус для гостя / customer / manager / admin, причина, для відмовлених ролей перевірка «роль першою» (хибні параметри не змінюють 401/403, відповідь лише `message`/`code`/`errors`), для публічних — явна позначка.

| ендпоінт | доступ | гість | customer | manager | admin | чому |
| --- | --- | --- | --- | --- | --- | --- |
| GET /menu | **публічний** | 200 | 200 | 200 | 200 | меню сайту: категорії й бренди, публічні дані |
| GET /stock/cache-check | admin | 401 | 403 | 403 | 200 | службова перевірка кешу залишків, лише admin |
| POST /stock/cache-rebuild | admin | 401 | 403 | 403 | 200 | службова перебудова кешу залишків, лише admin |
| GET /cash/cache-check | admin | 401 | 403 | 403 | 200 | службова перевірка кешу кас, лише admin |
| POST /cash/cache-rebuild | admin | 401 | 403 | 403 | 200 | службова перебудова кешу кас, лише admin |
| GET /stock/product/:id | staff | 401 | 403 | 200 | 200 | В11: admin бачить залишки з вартістю, manager лише кількість; customer 403 |
| GET /reports/stock | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| GET /reports/purchases | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| GET /reports/expenses | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| GET /reports/profit | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| GET /reports/debts | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| GET /reports/salary | admin | 401 | 403 | 403 | 200 | R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin) |
| POST /users/favorites | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | обране поточного користувача |
| GET /users/favorites/my | optional-auth | 200 | 200 | 200 | 200 | гість отримує порожній список (200), авторизований свої id |
| GET /users/favorites | optional-auth | 200 | 200 | 200 | 200 | гість отримує порожній список (200), авторизований свої товари |
| DELETE /users/favorites/:id | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | обране поточного користувача |
| PATCH /users/update | auth | 401 | 200 | 200 | 200 | власні контактні дані; білий список name, surname, phone, city, street |
| GET /pages/:slug | **публічний** | 200 | 200 | 200 | 200 | публічна сторінка сайту |
| GET /posts | **публічний** | 200 | 200 | 200 | 200 | публічний список постів |
| GET /posts/:slug | **публічний** | 404 | 404 | 404 | 404 | публічний пост |
| GET /brands/:slug | **публічний** | 200 | 200 | 200 | 200 | публічна картка бренду |
| GET /products/products-category/:slug | **публічний** | 200 | 200 | 200 | 200 | публічний каталог |
| GET /products/products-brand/:slug | **публічний** | 200 | 200 | 200 | 200 | публічний каталог |
| GET /products/products-search | **публічний** | 200 | 200 | 200 | 200 | публічний пошук |
| GET /products/bestsellers | **публічний** | 200 | 200 | 200 | 200 | публічний каталог |
| GET /products/:identifier | **публічний** | 200 | 200 | 200 | 200 | публічна картка товару (за id або slug); перекриває стандартний GET /products/:id |
| GET /carts/me | auth | 401 | 200 | 200 | 200 | кошик поточного користувача |
| POST /carts/add-item | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | кошик поточного користувача |
| PATCH /carts/update-item | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | кошик поточного користувача |
| POST /carts/remove-item | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | кошик поточного користувача; чужий cartId дає 403 |
| POST /carts/clear | auth | 401 | 200 | 200 | 200 | кошик поточного користувача |
| POST /carts/guest | **публічний** | 200 | 200 | 200 | 200 | розрахунок гостьового кошика з браузера (D5): товари й кількості, даних інших клієнтів немає |
| POST /carts/merge | auth | 401 | 2xx/4xx (умова) | 2xx/4xx (умова) | 2xx/4xx (умова) | об’єднання гостьового кошика зі своїм |
| POST /carts/promo | **публічний** | 400 | 400 | 400 | 400 | перевірка промокоду гостем і клієнтом; чужий cartId дає 403 |
| POST /orders/create | **публічний** | 201 | 201 | 201 | 201 | D5: гостьові замовлення потрібні; ціни, склад, менеджер, джерело, статус задає сервер |
| GET /orders/my | auth | 401 | 200 | 200 | 200 | власні замовлення клієнта у вигляді нормалізованого списку |
| POST /plugin-seo/generate-title | core | 200 | 200 | 200 | 200 | плагін seo: чиста функція над тілом запиту (generateTitle), даних із БД не читає; перевірки автентифікації в плагіні немає (FINDING-15) |
| POST /plugin-seo/generate-description | core | 200 | 200 | 200 | 200 | плагін seo: generateDescription не налаштовано, повертає порожній рядок (FINDING-15) |
| POST /plugin-seo/generate-url | core | 200 | 200 | 200 | 200 | плагін seo: чиста функція над тілом запиту (generateURL) (FINDING-15) |
| POST /plugin-seo/generate-image | core | 200 | 200 | 200 | 200 | плагін seo: generateImage не налаштовано, повертає порожній рядок (FINDING-15) |
| POST /reorder | core | 403 | 403 | 403 | 2xx/4xx (умова) | ядро Payload (orderable у variantTypes): перед зміною виконує access.update колекції (adminOnly) |

Додатково: `D › першою діє перевірка ролі › відмова не розкриває існування запису`; `D › відповіді не містять зайвих полів` (orders/my, users/update, favorites, carts/me); `D › L: усі шість /api/reports/* і кеш-перевірки лише admin`. Сторінка `/admin/reports` та посилання в меню: `tests/int/reportsView.access.int.spec.ts` (R2) на рівні компонента; через Next не перевірялась (див. розд. 7).

### 4.7. Local API (E), GraphQL (J), публічні відповіді (K), операційне (M)

| Ресурс | Перевірка | Тест |
|---|---|---|
| Ендпоінти й сервіси | кожен виклик з дефолтним `overrideAccess` класифіковано; новий без рішення = червоний; без застарілих рядків; `overrideAccess: false` завжди з `user` | `E` › 4 тести |
| Класифікація | кожне `FINDING-n` у таблицях має блок `[FINDING-n]` | `E` › «усі FINDING у класифікації…» |
| GraphQL | introspection і playground вимкнено в production (дефолти Payload 3.65.0 не перевизначені) | `J` › «introspection і playground вимкнено в production…» |
| GraphQL | облікові колекції й глобал закриті (Forbidden) для гостя, customer, manager | `J` › «облікові колекції недоступні…» |
| GraphQL | ті самі права на orders/users/products для customer, manager, гостя (accounting, manager, roles = null) | `J` › 4 тести |
| GraphQL | мутації customer на orders і складі відхиляються; `updateUser` не змінює roles | `J` › «мутації…», «ескалація через graphQL…» |
| GraphQL | versions: гість Forbidden; **customer читає (знахідка 10)**; ліміт складності діє (1500 аліасів відхилено) | `J` › «versions у graphQL…», «обмеження складності запиту діє» |
| Публічні товарні відповіді | лише `inStock` (булеве), без qty / вартості / залишків / складів на всіх публічних шляхах, при ввімкненому обліку | `K` › «товарні ендпоінти віддають лише inStock…» |
| Публічні відповіді | повідомлення про помилки без id, шляхів, стеку (9 запитів) | `K` › «повідомлення про помилки публічних ендпоінтів…» |
| createOrder 409 | форма відповіді зафіксована; **`items[].available` віддається будь-кому (знахідка 11)** | `K` › «createOrder при нестачі…», `[FINDING-11]` |
| Міграції й скрипти | не створюють користувачів зі стандартними паролями | `M` › «міграції й скрипти не створюють користувачів…» |
| Скрипти імпорту | не імпортуються з `src/`, не мають `handler` (мережею недоступні) | `M` › «скрипти імпорту не підключені як ендпоінти…» |
| Секрети | не логуються; `PAYLOAD_SECRET` лише в `payload.config.ts`; у відповідях login/me/list немає `hash`, `salt`, токенів | `M` › 3 тести (лог, `PAYLOAD_SECRET`, відповіді API) |

## 5. Знахідки

Позначення: файл:рядок — де причина; «Відтворення» — фактичні запити й відповіді з прогону (БД `cosmetics_test`); «Рекомендація» — мінімальна зміна, **без впровадження**.

### Критичні

#### 1. Customer і гість самі роблять себе оптовиками зі знижкою до 50 %

- **Де:** `src/collections/Users/index.ts:38` (`notManager = !isManager(user)`), `:105` і `:143` (`access: { create: notManager, update: notManager }` для `wholesale` і `brandDiscounts`), `:45` (`create: publicAccess`), `:48` (`update: adminOrSelf`).
- **Причина:** `notManager` забороняє лише manager. Для гостя й customer повертає `true`. Розд. 11 дизайну: `users.manager, roles, wholesale, brandDiscounts: update` — тільки admin.
- **Відтворення:**
  - `POST /api/users` (без токена) з `{email, password, ..., "wholesale": true, "brandDiscounts": [{"brand": "<id>", "discountPercent": 50}]}` → `201`; у БД `wholesale: true`, `brandDiscounts: [{discountPercent: 50}]`.
  - `PATCH /api/users/<свій id>` від customer з тим самим тілом → `200`, у БД ті самі значення.
  - Наслідок: після цього `POST /api/orders/create` від такого клієнта дав `total` 80 замість 100 (оптова ціна товару) — `expected 80 to be 100`.
  - `roles` і `manager` у тих самих запитах **ігноруються** (перевірено).
- **Рекомендація:** для обох полів `create` і `update` — `adminOnlyFieldAccess` (замість `notManager`). Для manager поведінка не змінюється (він і так не може).
- **Тест:** `[FINDING-1]` (3 тести).

#### 2. Customer змінює й видаляє контент і каталог (дефолтний access)

- **Де:** `src/collections/Pages/index.ts:11`, `Posts/index.ts:12`, `Categories.ts:10`, `Brands/index.ts:11`, `Media.ts:18`: у `access` задано лише `read: publicAccess`; `create`/`update`/`delete` лишилися `defaultAccess` (`Boolean(user)`).
- **Відтворення (customer, токен звичайного клієнта):**
  - `POST /api/brands` → `201`; `PATCH /api/brands/<id>` `{title: "HACKED"}` → `200` (в БД змінилось); `DELETE /api/categories/<id>` → `200`, документа немає.
  - `DELETE /api/categories?where[slug][equals]=…` → `200`, документ видалено (масово).
  - `pages`: `POST` → `201`. `posts`, `media`: `POST {}` → `400` (дійшло до валідації, access пройдено), `PATCH`/`DELETE` на неіснуючий id → `404` (а не `403`).
  - Реєстрація публічна, тобто це може будь-хто за хвилину.
- **Рекомендація:** додати `create/update/delete: adminOnly` (або `adminOrManager`, якщо так вирішить власник, питання Q2) у п'ять колекцій.
- **Тест:** `[FINDING-2]` (8 тестів: створення/зміна/видалення, масове видалення, posts, media).

#### 3. Customer читає й видаляє `form-submissions`

- **Де:** `src/plugins/index.ts:41-60` (`formBuilderPlugin`, у `formSubmissionOverrides` лише `admin.hidden`); у плагіні `read: ({req:{user}}) => !!user`, `delete` не задано (= `defaultAccess`).
- **Відтворення:** `GET /api/form-submissions` від customer → `200` (список); `DELETE /api/form-submissions/<id>` → `404` для неіснуючого (для існуючого було б видалення). У тестовій БД відправлень немає, тому вміст не показано; ризик залежить від того, чи сайт використовує форми (колекція сховано в адмінці, питання Q3).
- **Рекомендація:** `formSubmissionOverrides.access`: `read` і `delete` — `adminOrManager` (або `adminOnly`); `create` лишити публічним.
- **Тест:** `[FINDING-3]`.

### High

#### 4. Customer створює форми, які розсилають листи на довільні адреси

- **Де:** `src/plugins/index.ts:41-60` (`formOverrides` без `access`); `create/update/delete` форм = `defaultAccess`. Поле `emails` (одержувачі, тема, текст) задає автор форми.
- **Відтворення:** `POST /api/forms` від customer з `emails: [{emailTo: "victim@…", subject, message}]` → `201`. Контроль: така сама форма від admin + `POST /api/form-submissions` від гостя (create публічний) → `payload.sendEmail` викликано з адресою жертви (тест-контроль зелений). Отже customer може спрямувати поштові розсилки сервера (`noreply@nextlevelshop.md`, Resend) на будь-яку адресу з довільним текстом.
- **Рекомендація:** `formOverrides.access`: `create/update/delete: adminOnly`; або прибрати плагін, якщо форми не використовуються.
- **Тест:** `[FINDING-4]` (контрольний тест зелений, 2 `it.fails`).

#### 5. Будь-який авторизований розблоковує чужі акаунти

- **Де:** `src/collections/Users/index.ts:43-49`: `access` без `unlock` → `defaultAccess`.
- **Відтворення:** `POST /api/users/unlock {"email": "<чужий>"}` від customer → `200 {"message":"Success"}`; від гостя → `403`.
- **Наслідок:** блокування після невдалих спроб входу (захист від підбору пароля) знімає будь-який зареєстрований користувач; отже підбір пароля жертви не обмежений.
- **Рекомендація:** `access.unlock: adminOnly`.
- **Тест:** `[FINDING-5]`.

#### 6. Гість створює кошики, зокрема для чужого customer

- **Де:** `src/collections/Carts/index.ts` не задає `access`; плагін ecommerce (`createCartsCollection.js:104`) ставить `create: publicAccess`; поле `customer` клієнт задає сам.
- **Відтворення:** `POST /api/carts` без токена з `{"customer": "<id жертви>", "items": [{"product": "<id>", "quantity": 7}], "currency": "MDL"}` → `201`; після цього `GET /api/carts/me` від жертви повертає цей товар (7 шт.), `GET /api/carts` бачить документ. Customer теж може так зробити.
- **Рекомендація:** `create` лише для авторизованих і примусово `customer = req.user.id` (хук `beforeValidate` або `access` поля `customer`).
- **Тест:** `[FINDING-6]` (3 тести).

#### 7. Оракул: `sort` за закритими полями відкриває порядок значень

- **Де:** ядро Payload 3.65.0: `where` перевіряє право читання поля (`validateSearchParams.js:75-130`), `sort` — ні. Колекції `orders` (`accounting.*`), `products` (`wholesalePrice`).
- **Відтворення:** у customer два свої замовлення з `cogsBani` 777 і 111. `GET /api/orders?sort=accounting.cogsBani` → `[замовлення 111, замовлення 777]`, `sort=-accounting.cogsBani` → `[777, 111]`. Те саме для manager (чотири замовлення, відсортовані за собівартістю) і для гостя та customer на товарах (`sort=wholesalePrice`: `[retail 200 (опт 10), retail 100 (опт 80)]`, а `-wholesalePrice` навпаки). Для порівняння `where[accounting.cogsBani][greater_than]=0` → `400`, оракула немає.
- **Наслідок:** відносний порядок собівартості (В11: «manager собівартості не бачить») і оптових цін доступний тим, кому поле закрите; з порівнянням із `total`/роздрібною ціною можна ранжувати маржу.
- **Рекомендація:** хук `beforeOperation` (read) у `orders`, `products`, `users`, який замінює `args.sort` на дефолтний, якщо поле сортування закрите для користувача (або відхиляє 400, як `where`).
- **Тест:** `[FINDING-7]` (3 тести).

#### 8. `createOrder` приймає від'ємну й дробову кількість

- **Де:** `src/collections/Orders/endpoints/createOrder.ts:55` (`!item.quantity`), `:75` (`Number(item.quantity)`); `populatePricesAndTotal.ts` обнуляє від'ємну суму (`Math.max(0, …)`).
- **Відтворення:** `POST /api/orders/create` (гість) з `items: [{product: A, quantity: 1}, {product: B, quantity: -2}]` → `201`; замовлення зберігається з від'ємною позицією й сумою, обнуленою до 0. Окремо `quantity: -5` і `0.5` → `201`. Сума замовлення рахується як `max(0, Σ qty·price − discount)`, тож від'ємна позиція може «гасити» вартість іншої. Зі ввімкненим обліком складу від'ємну кількість відхилить журнал (`stockLedger.service.ts:79`, звичайна `Error`), тобто клієнт отримає 500 замість 400 (за кодом, у тесті не відтворено); поки `stockControlEnabled: false`, перешкоди немає.
- **Рекомендація:** у `createOrder` вимагати `Number.isInteger(q) && q > 0` (і розумну верхню межу), інакше `400`.
- **Тест:** `[FINDING-8]` (3 тести).

### Medium

#### 9. Неопубліковані товари публічні

- **Де:** виклики `payload.find/findByID` з `overrideAccess` за замовчуванням (`true`) у публічних ендпоінтах: `getSingleProduct.ts:17`, `searchProducts.ts:53`, `getBestSellers.ts:9`, `productsByRelation.service.ts:130`, `getFavorites.ts:19`, `normalizedCart.ts:59` (гостьовий кошик), `createOrder.ts:59`. `draft: false` не фільтрує `_status`. Крім того `GET /api/products/:identifier` перекриває стандартний `GET /api/products/:id` (розд. 3.3), тож і стандартне правило `adminOrPublishedStatus` для одиночного читання не діє.
- **Відтворення (гість):** `GET /api/products/<id чернетки>` → `200` з `title`, `retailPrice`; та сама чернетка у `products-brand`, `products-search`, `POST /carts/guest`, `GET /users/favorites` (якщо id додано в обране) і `POST /orders/create` → `201` за ціною чернетки. `GET /api/products?draft=true` для гостя чернеток **не** повертає (стандартний шлях захищений).
- **Рекомендація:** у цих запитах `where: {_status: {equals: 'published'}}` або `overrideAccess: false, user: req.user`.
- **Тест:** `[FINDING-9]` (6 тестів). `bestsellers` має ту саму причину (`getBestSellers.ts:9`), але в тесті не відтворено детерміновано (список обмежено 10 записами).

#### 10. `readVersions` не задано: історію версій читає будь-який авторизований

- **Де:** `Products/index.ts:37-41` (`...defaultCollection.access`, `readVersions` немає), те саме в `variants`. `executeAccess(…, undefined)` у 3.65.0 пускає будь-якого користувача.
- **Відтворення:** `GET /api/products/versions/<id версії чернетки>` від customer → `200` (`title`, `retailPrice` чернетки); гість → `403`. `{ versionsProducts { totalDocs } }` у GraphQL від customer → успішна відповідь з лічильником (у прогоні 28), від гостя → Forbidden. `wholesalePrice` у версіях приховується field access.
- **Рекомендація:** `access.readVersions: adminOrManager` у `products` і `variants`.
- **Тест:** `[FINDING-10]` (REST і GraphQL).

#### 11. 409 при нестачі віддає точний залишок будь-кому (питання власнику Q1)

- **Де:** `createOrder.ts:183` (`items.map(({ product, requested, available }) => …)`).
- **Відтворення:** гість `POST /api/orders/create` на 5 шт. при 3 на складі сайту → `409 {"success": false, "code": "INSUFFICIENT_STOCK", "message": "…", "items": [{"product": "…", "requested": 5, "available": 3}]}`.
- **Суперечність:** рішення В4 — фронтенду віддаємо лише `inStock: boolean`, кількість не показуємо; тут точний залишок отримує будь-хто без входу (можна опитувати всі товари).
- **Рекомендація:** прибрати `available` з відповіді (залишити `product`, `requested` або булеве), якщо Q1 підтвердить В4.
- **Тест:** `[FINDING-11]`.

#### 12. `products-brand` і `products-category` віддають `inventory`

- **Де:** `productsByRelation.service.ts:137-143`: `select` без `inventory: false`, тоді як `getBestSellers`, `getSingleProduct`, `searchProducts`, `getFavorites` його виключають.
- **Відтворення:** `GET /api/products/products-brand/<slug>` (гість) → кожен товар має поле `inventory` (поле плагіна ecommerce, приховане в адмінці `hideStockProductFields`; у тестовій БД значення за замовчуванням, у проді може бути історичний залишок — питання Q8).
- **Рекомендація:** додати `inventory: false` у `select`.
- **Тест:** `[FINDING-12]`.

### Low

13. **Гігієна облікових записів** (`Users` auth). `PATCH /api/users/<id>` зі зміною `email` → `200`, `_verified` лишається `true` (Payload шле верифікацію лише при створенні). Реєстрація приймає службові поля: `resetPasswordToken`, `resetPasswordExpiration`, `loginAttempts`, `lockUntil` записуються в БД (відтворено: `resetPasswordToken: "attacker-reset"`, `loginAttempts: 7`, `lockUntil` у майбутньому). `hash`, `salt`, `_verificationToken`, `_verified` ігноруються. Власник акаунта може лише власний акаунт; ескалації немає, але це зайва поверхня (теоретичний сценарій, не відтворений: атакуючий реєструє адресу жертви зі своїм паролем і чекає, поки жертва підтвердить пошту; це властивість будь-якої реєстрації з відкладеною верифікацією, поля лише спрощують його). Рекомендація: хук `beforeValidate` у Users, що видаляє ці поля з `data` для не-admin, і скидання `_verified` при зміні `email`. Тест `[FINDING-13]`.
14. **500 замість 404.** `getPageBySlug.ts:22`, `getBrandInfo.ts:19`, `getSinglePost.ts:19` повертають `Response.json(docs[0])`; для неіснуючого slug `undefined` не серіалізується → `500 Something went wrong`. Те саме для `GET /api/pages/versions` (потрапляє в `/:slug`) і `GET /api/orders/versions` (колекція без versions; Payload кидає помилку про модель версій). Деталі реалізації у тіло не потрапляють. Рекомендація: `404`, якщо документа немає. Тест `[FINDING-14]`.
15. **`plugin-seo`.** `POST /api/plugin-seo/generate-{title,description,url,image}` відповідають гостю `200`: плагін не перевіряє автентифікацію. Зараз це чисті функції над тілом запиту (`generateTitle`, `generateURL` у `plugins/index.ts`), БД не читають; ризик — лише в майбутніх змінах. Рекомендація: не покладатися на ці маршрути або обгорнути перевіркою `req.user`. Тест `[FINDING-15]`.
16. **Порядок перевірок у `addCartItem`.** `addCartItem.ts:13-14` читає й деструктурує тіло до `if (!user)` на `:16`: гість із `{}` отримує `500` (TypeError), а не `401`. Тест `[FINDING-16]` та виняток у `ENDPOINTS` (`roleFirstFinding`).
17. **Розкриття існування `cartId`.** `removeCartItem.ts:33`, `validatePromo.ts:72`: `findByID` без перевірки власності; чужий кошик → `403 Cart not found or forbidden`, неіснуючий → `404 Not Found`. `cartId` — ObjectId, вгадати важко, тож ризик малий. Тест `[FINDING-17]`.
18. **GraphQL для внутрішніх колекцій (рекомендація).** `graphQL: false` ніде не задано, схема містить усі облікові колекції. Права в GraphQL ті самі (перевірено, `J`), introspection у production вимкнено за замовчуванням, ліміт складності діє. Але зайва поверхня: рекомендовано вимкнути для `stock-*`, `cash-*`, `payrolls`, `salary-schemes`, `suppliers`, `warehouses`, `promo-codes`, `transactions`, `opening-balances`, `purchases` і глобалу `accounting-settings`, якщо фронтенд GraphQL не використовує (Q5). Тест `[FINDING-18]`.

## 6. Питання до власника

| № | Питання | Контекст і рекомендація |
|---|---|---|
| Q1 | Чи лишати в 409 точний залишок (`items[].available`)? | Знахідка 11, суперечить В4. Рекомендація: прибрати; якщо фронтенд має підказати «є лише N», краще віддавати це лише авторизованим або округленням (наприклад, «більше 10»). |
| Q2 | Чи може manager створювати/редагувати/видаляти контент (сторінки, пости, категорії, бренди, файли, форми)? | Сьогодні може випадково (дефолтний access), розд. 11 про це мовчить. Тест фіксує «admin і manager так» (`RESOURCES`). Рекомендація: лише admin, а редагування контенту manager дозволити явним рішенням. |
| Q3 | Чи використовуються форми (form-builder) та їхні відправлення? | Знахідки 3 і 4. Якщо ні — прибрати плагін (колекції `forms`, `form-submissions` зникнуть з поверхні). Якщо так — закрити `read`/`delete`/`create` форм для персоналу. |
| Q4 | Чи припустимі різні відповіді `/api/carts/promo` для «код не знайдено / не активний / прострочений / не підходить»? | Гість може перебирати промокоди й бачити стан. Це зручно для UX; для захисту від підбору потрібен rate limit (рекомендація для Nginx). |
| Q5 | Чи використовує фронтенд GraphQL? | Знахідка 18. Якщо ні, `graphQL: false` для всього або принаймні для облікових колекцій. |
| Q6 | Чи потрібне підтвердження пошти при зміні email? | Знахідка 13. |
| Q7 | Чи є причина дозволяти замовлення неопублікованих товарів (передзамовлення)? | Знахідка 9. Рекомендація: ні. |
| Q8 | Чи є в продакшн-БД ненульові значення історичного поля `inventory` у товарів? | Знахідка 12: якщо є, вони зараз публічні в `products-brand` і `products-category`. |

## 7. Що не перевірялось і чому

- **Маршрути Next.js** (`src/app/(payload)`, `(frontend)`): за `CLAUDE.md` не читаються й не змінюються. Тому не перевірено: сторінки адмінки через Next (`/admin/reports` покрито лише на рівні компонента в `reportsView.access.int.spec.ts`), маршрути preview/draft (`PREVIEW_SECRET`), live preview, middleware.
- **Мережевий шар:** `handleEndpoints` викликається напряму, тож CORS/CSRF-перевірки (`cors`, `csrf` у конфігу), атрибути cookie (`secure`, `SameSite`, `domain`; у робочій копії закоментовано, див. розд. 1), rate limiting, TLS і заголовки не перевірялись. Для цього потрібен живий сервер.
- **Продакшн-налаштування:** значення `NODE_ENV` на сервері (introspection вимкнений за замовчуванням лише в `production`; перевірено конфіг, не середовище), конфігурація MongoDB (`bindIp`, авторизація, порт 27017), Nginx.
- **Завантаження файлів:** типи, розмір і вміст `media` (лише права на запис, див. знахідку 2).
- **Сесії й токени:** термін JWT 14 діб без сесій (`useSessions: false`): відкликати токен неможливо до закінчення терміну (спостереження, не знахідка).
- **Бізнес-логіка** складу, фінансів і зарплати (покрито окремими наборами M/R/C/S), гонки й транзакції.
- **Email/Telegram:** зміст і доставка листів (у тестах транспорт замінено заглушкою).
- **Прямі запити до MongoDB** у звітах і кеш-перевірках (`payload.db.collections…aggregate`) обходять access за задумом; захищені перевіркою `requireAdmin` (ENDPOINTS, `D`).
- **Статичний сканер Local API** — евристика (розд. 3.4); викликів через нестандартні змінні він не бачить.

## 8. Як вмикати тести знахідок

Кожен блок `describe('[FINDING-n] …')` у `tests/int/accessAudit.int.spec.ts` описує **правильну** поведінку й написаний через `it.fails`. Для такого тесту vitest вважає успіхом саме падіння, тому набір лишається зеленим, доки знахідка не виправлена.

Після виправлення знахідки:
1. Запустіть `vitest run tests/int/accessAudit.int.spec.ts`: тести цього блоку позначаться червоними з повідомленням «Expect test to fail».
2. Замініть у блоці `it.fails(` на `it(` (зелені контрольні тести в блоці лишіть). Тепер він справжній регресійний захист.
3. Приберіть відповідні рядки з таблиць `tests/int/helpers/accessAuditTables.ts`: `KNOWN_DEVIATIONS`, `DEFAULT_ACCESS_FINDINGS`, `LOCAL_API_REVIEW` (клас `FINDING-n` змінити на `own`/`public`/…), `roleFirstFinding`/`knownDeviation` в `ENDPOINTS`. Тест «знахідки з дефолтним access… досі актуальні» сам нагадає про застарілі рядки.

Запуск без `pnpm` (його немає в shell цього середовища): `node_modules/.bin/vitest run tests/int/accessAudit.int.spec.ts`; повний набір — `pnpm test:int`.

## 9. Рекомендації для сервера (не зміни коду)

- **Nginx:** обмежити `/api/reports/` за IP (там суми, прибуток, зарплата); окремо `location /api/users/login`, `/api/users/forgot-password`, `/api/users` (POST), `/api/orders/create`, `/api/carts/promo` — `limit_req` (захист від підбору паролів і промокодів, спаму замовлень, D5).
- **Nginx:** закрити від зовнішнього світу `/admin` за IP/VPN або додатковою автентифікацією, якщо адмінка не потрібна всім.
- **MongoDB:** порт 27017 закрити файрволом ззовні; в `/etc/mongod.conf` `net.bindIp: 127.0.0.1`; увімкнути авторизацію (`security.authorization: enabled`) і окремого користувача застосунку з мінімальними правами (D6).
- Переконатися, що на сервері `NODE_ENV=production` (вимикає introspection і playground GraphQL), `PAYLOAD_SECRET` довгий і унікальний, `.env` не в репозиторії (у `.gitignore` є; в репозиторії лише `.env.example` і `test.env` без секретів).
- Cookie автентифікації: `secure: true`, `SameSite=Lax`, `domain` (закоментований у робочій копії рядок має діяти на проді).

## 10. Підсумок

**До релізу: НЕ ДОЗВОЛЕНО.**

Умови для дозволу:
1. Виправлені **Critical** 1, 2, 3 (самопризначення оптових цін і знижок, запис у каталог для customer, читання відправлень форм). Для 3 і 4 достатньо вимкнути плагін форм, якщо Q3 = «не використовуються».
2. Виправлені **High** 4, 5, 6, 7, 8 (розсилка листів через форми, розблокування чужих акаунтів, чужі кошики, оракули `sort`, валідація кількості).
3. Відповіді на Q1 та Q2; **Medium** 9–12 бажано закрити до релізу (зокрема 9: чернетки публічні) або явно прийняти ризик.
4. Low 13–18 можна виправляти після релізу, 16 і 14 — одним дрібним комітом.
5. Після кожного виправлення: перемкнути відповідний блок `[FINDING-n]` з `it.fails` на `it` (розд. 8), `tsc --noEmit`, `pnpm lint`, `pnpm test:int` зелені.

Виправлення за домовленістю робляться окремими комітами (мінімальні зміни, по знахідці). `R3` у `tasks.md` буде позначена виконаною після виправлення Critical/High; зараз там статус «аудит виконано, виправлення очікують».

## 11. Статус виправлень (2026-10-26)

Виправлено, кожне окремим комітом, з переходом тесту `[FINDING-n]` з `it.fails` на `it`:

| Знахідка | Коміт | Зміна |
|---|---|---|
| 1 | `a6ff421` | `wholesale`, `brandDiscounts`: лише admin |
| 2 | `368ba2f` | запис у pages, posts, categories, brands, media: `adminOrManager` |
| 5 | `aff0249` | `users.unlock: adminOnly` |
| 6 | `77cb68e` | створення кошика лише авторизованим, власник = `req.user` |
| 8 | `079af4e` | `createOrder`: лише ціла додатна кількість |
| 7 | `d2dc05b` | `guardSortFields`: `sort` за закритим полем дає 400 |
| 3, 4 | плагін прибрано | form-builder видалено з `plugins/index.ts` (Q3: форми не використовуються) |

Рішення Q2 (manager і контент): збережено запис для admin і manager. Залишаються відкритими Medium 9–12 і Low 13–18. Колекції `forms` і `form-submissions` у MongoDB (якщо існують) не видалялись; пакет `@payloadcms/plugin-form-builder` лишається в `package.json` (видалення залежності окрема дрібна задача).
