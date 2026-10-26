# Товарний і фінансовий облік: план задач

Дата: 2026-10-24. Дизайн: `docs/accounting/design.md` (далі «дизайн», посилання на розділи).
Формат як у `docs/plan.md`: одна задача = один коміт. Складність XS / S / M / L.
Модель: Sonnet (механічна або за готовою схемою) / Opus (транзакції, гроші, зміна поведінки).

Загальний критерій готовності кожної задачі: `tsc --noEmit` чистий, `pnpm lint` без нових
errors, `pnpm generate:types` після зміни колекцій, `pnpm test:int` зелений, нові тести
на тестовій БД `cosmetics_test`. Усі виклики Local API з `req`. Нові ендпоінти явно
перевіряють роль (D7). Нових залежностей немає.

**Ворота перед реалізацією:** ворота з `docs/plan.md` пройдено (merge `refactor`,
прод на replica set). Відповіді на В1-В17 з дизайну записані в `docs/decisions.md`;
задачі, що залежать від питання, позначені «залежить від Вn».

Етапи самостійні: після кожного можна зупинитись, система працює.
Етап 2 не можна вмикати (`stockControlEnabled`) без етапу 1 і початкових залишків.

---

## Етап 1. Склад і закупівлі

Після етапу: довідники, закупівлі, переміщення, списання, інвентаризація, початкові
залишки товару, звіт залишків. Замовлення ще не списують.

- [x] **A1. Спільний лічильник документів.**
  Мета: один механізм номерів для всіх документів (дизайн, розд. 8).
  Файли: новий `src/services/counters.ts`, `src/collections/Orders/hooks/setOrderNumber.ts`.
  Готово: `nextCounterValue(req, key, seed?)` винесено; `setOrderNumber` використовує його,
  поведінка тотожна (тест `orderNumber.int.spec.ts` зелений без змін); тест: паралельні
  `nextCounterValue` для нового ключа дають різні номери; хелпер `formatDocNumber('PUR', n)`.
  Складність: S. Модель: Sonnet.

- [x] **A2. Поле грошей у банях.**
  Мета: ввід і показ MDL з двома знаками, зберігання цілих банів (розд. 5.1).
  Файли: новий `src/fields/money.ts`, компонент `src/components/MoneyField/` (за зразком
  `Orders/components/PriceField.tsx`), `src/utilities/money.ts` (`toBani`, `formatMDL`, `allocateLargestRemainder`).
  Готово: фабрика `moneyField({ name, ... })` з `validate` (ціле), компонент Field і Cell;
  юніт-тести `toBani(12.5) = 1250`, `allocateLargestRemainder` на прикладі з розд. 5.2
  (обидві бази) і на крайніх випадках (L = 0, один рядок, рівні ваги).
  Складність: S. Модель: Sonnet.

- [x] **A3. Довідник складів і глобал налаштувань.**
  Мета: `warehouses` і `accounting-settings` (розд. 2.1).
  Файли: `src/collections/Warehouses/index.ts`, `src/globals/AccountingSettings.ts`,
  `src/payload.config.ts`, міграція з сидом `main`, `shop`.
  Готово: admin-only доступ; `stockControlEnabled = false` за замовчуванням;
  `defaultWebWarehouse` вказує на `main` після міграції; іконки в `payloadSidebar`.
  Складність: S. Модель: Sonnet.

- [x] **A4. Довідник постачальників.**
  Мета: `suppliers` (розд. 2.1).
  Файли: `src/collections/Suppliers/index.ts`, `src/payload.config.ts`.
  Готово: admin-only; пошук за назвою; `isActive` фільтрує вибір у документах (`filterOptions`).
  Складність: XS. Модель: Sonnet.

- [x] **A5. Журнал і кеш залишків.**
  Мета: `stock-moves`, `stock-balances`, `product-costs` (розд. 2.3, 4.1).
  Файли: три колекції в `src/collections/Stock/`, `src/payload.config.ts`.
  Готово: створення/зміна/видалення через REST і адмінку заборонені всім (лише код з
  `overrideAccess`); admin читає; складені індекси `uniq {product, variant, warehouse}`
  та інші з дизайну перевірені в тестовій БД.
  Складність: S. Модель: Sonnet.

- [x] **A6. Сервіс руху запасів.**
  Мета: єдине місце для зміни залишків і середньої (розд. 4.2, 5.3).
  Файли: `src/services/stock/stockLedger.service.ts`, `src/services/stock/session.ts`
  (сесія транзакції з `req`), `src/services/stock/errors.ts`.
  Готово: функції `receive`, `issue` (умовний `$inc`, собівартість `round(value×q/qty)`,
  оптимістична умова на `product-costs`), `transfer`, `revert(moves)`; кидають
  `InsufficientStockError` з деталями й `ConcurrentUpdateError`; вимагають відкриту
  транзакцію (інакше помилка). Тести: приклад з розд. 5.3 повністю; дві паралельні
  `issue` на останню одиницю — рівно одна успішна; після відкату транзакції кеш і журнал
  незмінні; останнє списання обнуляє `valueBani`.
  Складність: L. Модель: Opus.

- [x] **A7. Спільна логіка документа: статуси, незмінність, закритий період.**
  Мета: правила розд. 3.1 один раз.
  Файли: `src/services/documents/documentLifecycle.ts` (фабрика хуків і полів шапки).
  Готово: `draft → posted → reversed`; зміни в `posted` заборонені; видалення
  `posted/reversed` заборонене; `reversalReason` обов'язкова; дата ≤ `lockedUntil` блокує;
  проведення й сторно лише admin; повтор транзакції до 3 разів на транзієнтних помилках.
  Тести на кожне правило з тестовою колекцією або на A9.
  Складність: M. Модель: Opus.

- [x] **A8. Розподіл логістики в закупівлі.**
  Мета: чиста функція розрахунку накладної (розд. 5.2).
  Файли: `src/collections/Purchases/services/calculatePurchase.ts`.
  Готово: рахує `amountBani`, `allocatedBani`, `landedBani`, підсумки; база `amount` і
  `quantity`; тест відтворює обидві таблиці з розд. 5.2; Σ alloc = L завжди (property-тест
  на випадкових даних без нових залежностей).
  Складність: S. Модель: Sonnet.

- [x] **A9. Приходна накладна з проведенням і сторно.**
  Мета: `purchases` (розд. 2.2, 3.2).
  Файли: `src/collections/Purchases/index.ts`, хуки в `Purchases/hooks/`, `payload.config.ts`.
  Готово: чернетка рахує поля через A8 на кожне збереження; проведення викликає `receive`
  по рядках; сторно — умовне списання й правила `qty = 0 ⇒ value = 0`, блок при `value < 0`;
  тести: проведення змінює кеш і журнал; сторно без продажів повертає кеш у вихідний стан;
  сторно при недостатньому залишку відхилене й нічого не змінює.
  Складність: M. Модель: Opus.

- [x] **A10. Переміщення між складами.**
  Мета: `stock-transfers` (розд. 3.2).
  Файли: `src/collections/StockTransfers/index.ts`.
  Готово: склади різні; нестача на складі-джерелі блокує; `product-costs` не змінюється;
  сторно дзеркальне. Тести на кожне правило.
  Складність: S. Модель: Sonnet (огляд Opus).

- [x] **A11. Списання й інвентаризація.**
  Мета: `stock-adjustments` (розд. 2.2, 3.2).
  Файли: `src/collections/StockAdjustments/index.ts`.
  Готово: writeoff за середньою; inventory фіксує `expectedQty` при проведенні; надлишок
  при нульовій середній вимагає `unitCostBani`; сторно повертає точні значення. Тести.
  Складність: M. Модель: Sonnet (огляд Opus).

- [x] **A12. Початкові залишки товару і скрипт імпорту.**
  Мета: `opening-balances` kind=stock і CSV-імпорт (розд. 10).
  Файли: `src/collections/OpeningBalances/index.ts`, `scripts/import-opening-stock.ts`.
  Готово: скрипт створює лише чернетку й друкує звіт помилок (невідомий артикул, дубль
  товар×склад, qty ≤ 0, cost ≤ 0); проведення як прихід; тест на CSV із 3 рядків
  і на кожну помилку. Kinds cash/supplierDebt/customerDebt додаються в C1/C5.
  Складність: M. Модель: Sonnet.

- [x] **A13. Перевірка й перебудова кешу.**
  Мета: `rebuild-stock-cache` (розд. 4.4).
  Файли: `src/endpoints/stockCacheCheck.ts` (admin) або скрипт.
  Готово: `check` повертає розбіжності; `fix` перебудовує з журналу; тест: ручна
  псування кешу знаходиться й виправляється.
  Складність: S. Модель: Sonnet.

- [x] **A14. Залишок у картці товару.**
  Мета: admin бачить залишки по складах і середню в товарі.
  Файли: `ui`-поле в `src/collections/Products/index.ts`, компонент `src/components/StockPanel/`,
  ендпоінт `GET /api/stock/product/:id` (admin; для manager кількість без вартості — після M1, залежить від В11).
  Готово: поле не потрапляє в відповіді API (тип `ui`); ендпоінт перевіряє роль.
  Складність: S. Модель: Sonnet.

---

## Етап 2. Продажі й списання

Після етапу: замовлення списують залишок у транзакції створення, скасування повертає.
Вмикається прапорцем після проведення початкових залишків.

- [x] **S2.1. Заморозити проведене замовлення.** — залежить від підтвердження власника
  Мета: прибрати перерахунок цін на update (дизайн F6, Р2) і заборонити редагування після створення.
  Файли: `src/collections/Orders/hooks/populatePricesAndTotal.ts`, новий
  `Orders/hooks/guardPostedOrder.ts`, `Orders/index.ts`.
  Готово: `populatePricesAndTotal` працює лише на create; на update зміни `items`, `total`,
  `discount`, `customer` відхиляються; статус змінюється без зміни сум (тест: змінити
  `retailPrice` товару, потім статус замовлення — `total` той самий).
  Увага: змінює поведінку адмінки (зараз позиції можна редагувати). Узгодити з власником.
  Складність: S. Модель: Opus.

- [x] **S2.2. Облікові поля замовлення.**
  Мета: `source`, `warehouse`, `createdBy`, група `accounting`, `paidBani`, `paymentState` (розд. 2.5).
  Файли: `src/collections/Orders/index.ts`, `Orders/hooks/assignAccountingFields.ts`,
  `Orders/endpoints/createOrder.ts` (лише `context: { orderSource: 'web' }`).
  Готово: `accounting.*` читає лише admin (тест: клієнт через REST `GET /api/orders/:id` не
  бачить `accounting`); `getMyOrders` і відповідь `createOrder` без змін; `revenueBani` =
  `round(total×100)`; склад з налаштувань для web, ігнорує тіло запиту.
  Складність: S. Модель: Sonnet.

- [x] **S2.3. Списання при створенні замовлення.**
  Мета: хуки `deductOrderStock` і `writeOrderStockMoves` (розд. 4.2, 9.2).
  Файли: `Orders/hooks/deductOrderStock.ts`, `Orders/hooks/writeOrderStockMoves.ts`, `Orders/index.ts`.
  Готово: при `stockControlEnabled = false` нічого не робить; інакше списує через A6,
  пише `stockPostedAt`, `cogsBani`, рухи з собівартістю по позиціях; тести: успішне
  списання; нестача відкочує замовлення (замовлення в БД немає, кеш незмінний, сповіщень
  немає); створення з адмінки (Local API з `user` admin) теж списує.
  Складність: L. Модель: Opus.

- [x] **S2.4. Відповідь 409 і повтори в `createOrder`.**
  Мета: зрозуміла помилка нестачі для фронтенду (розд. 4.5, Р11).
  Файли: `Orders/endpoints/createOrder.ts`.
  Готово: `InsufficientStockError` ⇒ 409 `{ success: false, code: 'INSUFFICIENT_STOCK',
  message, items }`; транзієнтні помилки ⇒ до 3 повторів; успішна відповідь без змін;
  тест на паралельні гостьові замовлення останньої одиниці: одне 201, одне 409.
  Узгодити з фронтендом формат 409 до вмикання.
  Складність: M. Модель: Opus.

- [x] **S2.5. Скасування замовлення.**
  Мета: `cancelOrderStock` і заборона виходу з `cancelled` (розд. 9.1).
  Файли: `Orders/hooks/cancelOrderStock.ts`, `guardPostedOrder.ts`, `Orders/index.ts`,
  `beforeDelete` для проведених.
  Готово: повертає кількість і точну собівартість; історичне замовлення лише змінює статус;
  `paidBani > 0` блокує (після C3); закритий період блокує; видалення проведеного
  заборонене; тест «продаж 3, скасування» = приклад розд. 5.3.
  Складність: M. Модель: Opus. Залежить від В5.

- [x] **S2.6. Замовлення в адмінці для магазину.**
  Мета: продаж у «Магазині» без адреси (розд. 9.3).
  Файли: `Orders/index.ts` (умовне `required` для `shippingAddress.*`).
  Готово: адмін створює замовлення без адреси й клієнта зі складом «Магазин»; публічний
  `createOrder` без адреси як і раніше 400; тип `Order` перегенеровано.
  Складність: S. Модель: Sonnet.

- [x] **S2.7. `inStock` у відповідях товарів.** — залежить від В4
  Мета: фронтенд бачить наявність (лише додавання поля).
  Файли: `Products/services/productsByRelation.service.ts` (`transformProduct`),
  ендпоінти `getSingleProduct`, `searchProducts`, `getBestSellers`.
  Готово: `inStock` за `defaultWebWarehouse`; один запит `stock-balances` на сторінку
  (без N+1); інші поля відповідей без змін (знімок відповіді в тесті).
  Складність: S. Модель: Sonnet.

- [x] **S2.8. Запуск обліку складу (операційна).**
  Мета: процедура розд. 10, кроки 1-6, для товару.
  Файли: `docs/accounting/runbook.md`.
  Готово: чек-лист; перевірка replica set перед вмиканням (`hello().setName`);
  `accountingStartAt` ставиться разом із прапорцем; репетиція на копії прод-БД.
  Складність: S. Модель: Sonnet. Виконує власник з admin.

---

## Етап 3. Фінанси

Після етапу: каси, оплати покупців і постачальникам, витрати, переказ, борги.

- [x] **C1. Каси, статті витрат, початкові залишки кас.**
  Мета: `cash-accounts`, `expense-categories`, `cash-moves`, `opening-balances` kind=cash (розд. 2.1, 2.4).
  Файли: `src/collections/Finance/*`, `OpeningBalances/index.ts`, міграція з сидом `cash`, `bank` і статей.
  Готово: `balanceBani` лише RO; проведення OPN змінює баланс і журнал; сторно дзеркальне.
  Складність: S. Модель: Sonnet.

- [x] **C2. Касові операції: витрата, переказ, оплата постачальнику.**
  Мета: `cash-operations` (розд. 6.2), сервіс `src/services/finance/cashLedger.service.ts`.
  Готово: умовний `$inc` проти від'ємного балансу (якщо `allowNegative = false`);
  переказ атомарний (обидві каси або нічого); `isSalary` вимагає `manager`; тести на кожен тип і сторно.
  Складність: M. Модель: Opus.

- [x] **C3. Надходження й повернення від покупця.**
  Мета: типи `customer_receipt`, `customer_refund`; оновлення `paidBani`, `paymentState`.
  Файли: `cash-operations` хуки, `Orders` (поля з S2.2).
  Готово: переплата заборонена; скасоване замовлення не приймає оплату; сторно
  надходження зменшує `paidBani`; `status` замовлення не змінюється (В6); тести.
  Складність: M. Модель: Opus.

- [x] **C4. Борги постачальникам і початкові борги.**
  Мета: `opening-balances` kind=supplierDebt; розрахунок боргу (розд. 6.3).
  Файли: `src/services/finance/debts.service.ts`, `OpeningBalances/index.ts`.
  Готово: функція боргу на дату по постачальнику з урахуванням `extraCosts.payee` і
  сторнованих документів; тест на приклад: накладна 2 477,20 (у т.ч. логістика перевізнику
  150,00), оплата 1 000,00 ⇒ борг постачальнику 1 327,20, перевізнику 150,00.
  Складність: S. Модель: Sonnet.

- [x] **C5. Борги покупців.**
  Мета: борг по замовленнях і `opening-balances` kind=customerDebt.
  Файли: `debts.service.ts`, `OpeningBalances/index.ts`.
  Готово: історичне замовлення приймає оплату лише за наявності проведеного customerDebt;
  тест на частково оплачене замовлення.
  Складність: S. Модель: Sonnet.

- [x] **C6. Перевірка кешу кас.**
  Мета: як A13 для `cash-moves` ↔ `balanceBani`.
  Файли: `src/endpoints/cashCacheCheck.ts` або розширення A13.
  Складність: XS. Модель: Sonnet.

---

## Етап 4. Менеджери й звіти

Після етапу: роль manager, знімок менеджера, зарплата, звіти.

- [x] **M1. Роль manager і доступ до адмінки.** — залежить від В8-В12
  Мета: матриця прав розд. 11.
  Файли: `src/collections/Users/index.ts` (опція ролі, `access.admin`), нові
  `src/access/adminOrManager.ts`, `adminOrManagerField.ts`, `Products/index.ts` (access, field access цін),
  `Orders/index.ts` (create/read/update), `src/access/utilities.ts` не змінюється.
  Готово: тест-матриця: для кожного рядка розд. 11 запит від admin, manager, customer,
  гостя з `overrideAccess: false` дає очікуваний результат; manager не бачить
  `accounting.*`, `product-costs`, документи складу й фінансів.
  Увага: `Users/index.ts` має локальну незакомічену правку cookies, її не комітити.
  Складність: M. Модель: Opus.

- [x] **M2. Менеджер у клієнта.**
  Мета: `Users.manager` (розд. 2.5).
  Файли: `src/collections/Users/index.ts`, скрипт `scripts/import-customer-managers.ts`.
  Готово: змінює лише admin; manager при створенні клієнта стає його менеджером (В10);
  поле не віддається `updateUserInfo`/фронтенду (перевірити відповідь `me`), або читається лише admin/manager.
  Складність: S. Модель: Sonnet.

- [x] **M3. Знімок менеджера в замовленні.**
  Мета: правило розд. 7.1.
  Файли: `Orders/hooks/assignAccountingFields.ts`, `Orders/index.ts` (поле `manager`).
  Готово: тести на всі 5 сценаріїв таблиці 7.1; зміна менеджера клієнта не змінює старих замовлень.
  Складність: S. Модель: Sonnet (огляд Opus).

- [ ] **M4. Схеми зарплати й розрахунок.**
  Мета: `salary-schemes`, `payrolls` (розд. 2.5, 7.2).
  Файли: `src/collections/Salary/*`, `src/services/salary/calculatePayroll.ts`.
  Готово: чиста функція розрахунку з тестами на кожну комбінацію `base`, `dateBasis`,
  `attribution`; чернетка перераховується при збереженні, `posted` незмінний;
  `schemeSnapshot` зберігається; сторно лише без виплат; виплата через C2 (`isSalary`, `payroll`).
  Складність: L. Модель: Opus. Залежить від В13.

- [ ] **R1. Ендпоінти звітів.**
  Мета: `GET /api/reports/{stock,purchases,expenses,profit,debts,salary}` (розд. 12).
  Файли: `src/endpoints/reports/*`, `src/services/reports/*`.
  Готово: admin-only (явна перевірка ролі); агрегації MongoDB з `req`; тест прибутку
  відтворює приклад розд. 12 (8 050,00); тест боргів; індекси з дизайну використовуються (explain).
  Складність: L. Модель: Opus.

- [ ] **R2. View «Звіти» в адмінці.**
  Мета: один кастомний view `/admin/reports` з періодом і таблицями (розд. 13).
  Файли: `src/components/ReportsView/`, `payload.config.ts` (`admin.components.views`), посилання в сайдбарі.
  Готово: усі шість звітів, фільтр періоду, суми в MDL з двома знаками; доступ лише admin;
  manager бачить лише свої payroll (якщо В12 = так).
  Складність: M. Модель: Sonnet.

- [ ] **R3. Аудит доступу нового коду.**
  Мета: D7 для всіх нових колекцій і ендпоінтів.
  Файли: лише читання; звіт у `docs/accounting/access-audit.md`.
  Готово: таблиця «ресурс → перевірка → тест»; жодного ендпоінта без перевірки ролі.
  Складність: S. Модель: Sonnet.

---

## Залежності (коротко)

```
A1, A2 ─┬─> A5 ─> A6 ─> A7 ─┬─> A9 (A8), A10, A11, A12 ─> A13, A14
        │                   └─> S2.1 ─> S2.2 ─> S2.3 ─> S2.4, S2.5, S2.6, S2.7 ─> S2.8
        └─> C1 ─> C2 ─> C3, C4, C5, C6
M1 ─> M2 ─> M3 ─> M4 (C2) ─> R1 ─> R2, R3
```
