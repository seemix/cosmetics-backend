# Публічні ендпоінти та мова адмінки (I2)

Мова адмінки (`en`, `ru`, `ro`) не повинна впливати на відповіді, які читає сайт. Цей файл фіксує, що перевірено,
які місця лишилися без перекладу навмисно і що фронтенд має знати.

## Результат перевірки

1. **Жоден власний ендпоінт не використовує `req.t` / `req.i18n`.** Переклад через `req.t` є лише в хуках і валідаторах
   адмінських колекцій (склад, закупівлі, життєвий цикл документів), які недоступні публічному сайту.
2. **Текст `message` / `error` у відповідях лишився англійським і не залежить від заголовків запиту.**
   Тест `tests/int/publicApi.int.spec.ts` викликає 29 сценаріїв обробників з `req.t` кожної з трьох мов, вимагає
   однакових відповідей і порівнює їх зі знімком `tests/int/__snapshots__/publicApi.int.spec.ts.snap`.
   Знімок знято на коміті `f9b5819` (до I2), тож він доводить, що відповіді не змінилися.
3. **Стабільного поля `code` у публічних відповідях зараз немає.** Помилки мають форму `{ message }` або `{ error }`
   (форми різні, див. таблицю), успішні відповіді мають свою структуру. Поле `code` зі значенням `INSUFFICIENT_STOCK`
   з'явиться разом із задачею S2.4 (`createOrder`, 409). У I2 його не додано, щоб знімок лишився без змін.
   Фронтенд поки розрізняє помилки за HTTP-статусом.
4. **Вбудовані маршрути Payload (`/api/users/login`, CRUD колекцій тощо) перекладаються за `Accept-Language`.**
   Це наслідок I0: `ru` і `ro` стали мовами інтерфейсу, тож `errors[].message` вбудованих маршрутів приходить
   мовою заголовка (перевірено: `POST /api/users/login` з `Accept-Language: ru` повертає
   «Указанный email или пароль неверен.»). Власні ендпоінти нижче цього не стосується. Якщо сайт читає ці
   тексти, а не показує свої, він має або слати `Accept-Language: en`, або орієнтуватися на HTTP-статус.

## Власні ендпоінти сайту

Шлях колекційного ендпоінта: `/api/<slug колекції>/<path>`; глобальні: `/api/<path>`.

| Ендпоінт | Файл | Відповіді з текстом (статус: поле) |
|---|---|---|
| `POST /api/orders/create` | `Orders/endpoints/createOrder.ts` | 400: `error` «Items are required», «Shipping address is required», «Invalid item format», текст промокоду (див. нижче); 404: `message` «Product not found: &lt;id&gt;»; 500: `{ success: false, message: 'Failed to create order' }` |
| `GET /api/orders/my` | `Orders/endpoints/getMyOrders.ts` | 401: `message` «Unauthorized» |
| `POST /api/carts/add-item` | `Carts/endpoints/addCartItem.ts` | 401 «Unauthorized», 400 «Invalid request body», 403 «Cart not found or forbidden» (усі `message`) |
| `PATCH /api/carts/update-item` | `Carts/endpoints/updateCartItem.ts` | 401 «Unauthorized», 400 «Invalid body», 403 «Forbidden» (усі `error`) |
| `POST /api/carts/remove-item` | `Carts/endpoints/removeCartItem.ts` | 401 «Unauthorized», 400 «Invalid request body», 403 «Cart not found or forbidden», 404 «Item not found in cart» (усі `message`) |
| `POST /api/carts/clear` | `Carts/endpoints/clearCart.ts` | 401: `message` «Unauthorized» |
| `GET /api/carts/me` | `Carts/endpoints/getCartByUser.ts` | 401: `{ cart: null }` |
| `POST /api/carts/guest` | `Carts/endpoints/getGuestCart.ts` | 400: `error` «Items array is required» |
| `POST /api/carts/merge` | `Carts/endpoints/mergeCart.ts` | 401: `error` «Unauthorized» |
| `POST /api/carts/promo` | `Carts/endpoints/validatePromo.ts` | 400: `error` «Promo code is required», текст промокоду, «Cart not found or empty», «Cart ID or items required»; 404 «Cart not found»; 403 «Forbidden» |
| `POST /api/users/favorites`, `DELETE /api/users/favorites/:id` | `Users/endpoints/*Favorites*.ts` | 401: `message` «Unauthorized»; 200: `message` «Already in favorites» / «No such item» |
| `PATCH /api/users/update` | `Users/endpoints/updateUserInfo.ts` | 401: `message` «Unauthorized» |
| `GET /api/products/:identifier` | `Products/endpoints/getSingleProduct.ts` | 400 «Identifier is required», 404 «Product not found» (`message`) |
| `GET /api/brands/:slug`, `/api/pages/:slug`, `/api/posts/:slug` | `*/endpoints/*.ts` | 404: тіло — рядок `"Not found"` |
| `GET /api/menu`, `/api/posts`, `/api/products/*`, `/api/users/favorites*` (читання) | відповідні файли | лише дані; тексти помилок відсутні |

Тексти промокоду (`checkPromoCode`, `Carts/services/checkPromoCode.ts`) віддаються в `error` як є:
«Promo code is required», «Promo not found», «Promo is not active», «Promo not valid», «Promo expired».

### Службові (admin) ендпоінти

`GET /api/stock/product/:id`, `GET /api/stock/cache-check`, `POST /api/stock/cache-rebuild` повертають
`{ message }` «Unauthorized» (401), «Forbidden» (403), «Invalid product id» (400), «Product not found» (404).
Їх викликає адмінка, але мова адмінки в ці тексти теж не підставляється: вони лишилися англійськими
(у `StockPanel` помилку показує клієнт за статусом через `useTranslation()`).

## Помічене під час перевірки (не змінювалося)

- `updateCartItem` і `addCartItem` деструктурують `item` з тіла без перевірки: запит без `item` падає
  з `TypeError` і дає 500 замість 400.
- Форми помилок непослідовні (`error` проти `message`, у `Brands/Pages/Posts` тіло — голий рядок).
  Уніфікувати їх варто разом із введенням `code` (S2.4), узгодивши з фронтендом.

## Правила для нових публічних ендпоінтів

- Відповідь містить стабільний англійський `code` (SCREAMING_SNAKE_CASE) і `message`; фронтенд орієнтується на `code`.
- `message` не береться з `req.t` / словника адмінки. Тексти словника (`custom:error:*`) призначені лише для хуків
  адмінських колекцій. Приклад: нестача на складі в адмінці показується через `custom:error:insufficientStock`,
  а публічний `createOrder` віддає `409 { success: false, code: 'INSUFFICIENT_STOCK', message, items }`.
- Новий публічний ендпоінт додається до `tests/int/publicApi.int.spec.ts`, щоб його відповіді потрапили в знімок.
