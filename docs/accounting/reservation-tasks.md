# Резерв товару для замовлень до відвантаження: план задач (В23)

Дата: 2026-11-22. Рішення: В23 у `docs/decisions.md` (записує задача R0), змінює В20 і В21.
Формат як у `docs/accounting/tasks.md`: одна задача = один коміт. Складність XS / S / M / L.

**Моделі:**
- **Opus 5.5** (`claude-opus-5-5`): транзакції, умовні оновлення кешу, зміна поведінки, права.
- **Sonnet 5.5** (`claude-sonnet-5-5`): поля, i18n, UI-компоненти, документація за готовою схемою.

**Загальний критерій готовності кожної задачі:**
- `tsc --noEmit` чистий;
- `pnpm lint` без нових errors;
- `pnpm generate:types` після зміни колекцій (сам `src/payload-types.ts` не правити вручну);
- `pnpm test:int` зелений, нові тести на тестовій БД `cosmetics_test`.

Також: усі виклики Local API з `req`, нових залежностей немає, нові ключі i18n одночасно в `en`/`ru`/`ro`.

**Порядок:** R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8 → R9 → R10.

Резерв вмикається для всіх, щойно змерджено R4. Тому R4–R6 і R9 викочуються на прод разом, а R9 (міграцію наявних замовлень) запускають відразу після деплою.

---

## Як запускати задачу

У Claude Code: спершу `/model` із моделлю задачі, потім `/reservation-task R4` (номер задачі).
Команда `.claude/commands/reservation-task.md` містить спільний вступ і порядок роботи:
знаходить промт задачі в цьому файлі, перевіряє, що попередні задачі виконано, читає В20–В23,
запускає перевірки, ставить `[x]` і робить один коміт. Промти нижче вступу не дублюють.

---

## Задачі

- [x] **R0. Записати рішення В23.**
  Складність: XS. Модель: **Sonnet 5.5**.

  ```text
  Додай у docs/decisions.md рішення В23 «Резерв товару для замовлень до відвантаження»
  (статус: прийнято, не виконано) і рядок у зведену таблицю та журнал змін (2026-11-22).
  У В20 біля «Резерву немає» і у В21 біля переходів manager додай примітку «змінено В23».
  Зміст В23:
  - Резерв тримає облікове замовлення в pending або paid (чекає проведення, не скасоване).
    Доступно = qty − reserved. Резерв не пише stock-moves і не змінює собівартість.
  - Знімок резерву в замовленні: accounting.reservedItems [{product, warehouse, qty}],
    accounting.reservedAt. Знімається саме знімок, а не поточні позиції.
  - Новий статус backorder («Під замовлення»): без резерву, accounting.shortages
    [{product, warehouse, requested, available}] фіксує потребу клієнта. Ставиться автоматично,
    якщо при створенні з адмінки не вистачає товару. Сайт при нестачі, як і раніше, отримує 409.
  - Перехід backorder → pending вручну (admin, manager): резервуються всі позиції або жодної,
    при нестачі зміна відхиляється з переліком. pending/paid → backorder вручну знімає резерв.
    backorder → shipped заборонено.
  - Зміна позицій/складу pending: перерезервування в транзакції, при нестачі відмова.
  - Відвантаження знімає резерв і списує; скасування й видалення невідвантаженого знімають резерв.
  - Продаж, переміщення й повернення постачальнику не беруть зарезервоване; списання
    з інвентаризації дозволене нижче резерву (не нижче 0), тоді reserved > qty, це перепродаж.
  - accounting-settings.reservationDays (ціле ≥ 1, порожнє = без контролю). Після строку резерв
    лишається, admin і manager бачать віджет на дашборді й банер у замовленні.
  - Manager: pending → shipped, backorder → pending, pending → backorder. Скасовує й видаляє admin.
  - Сайт: inStock = qty − reserved > 0 на defaultWebWarehouse.
  Код не змінюй.
  ```

- [x] **R1. Резерв у кеші залишків і сервісі складу.**
  Складність: M. Модель: **Opus 5.5**.
  Файли: `src/collections/Stock/StockBalances.ts`, `src/services/stock/stockLedger.service.ts`,
  `src/services/stock/errors.ts`, `src/collections/StockAdjustments/index.ts` (лише виклик), i18n, тести.

  ```text
  Задача R1 (В23): резерв у stock-balances і stockLedger.service.ts.
  1. У stock-balances додай поле reserved (number, ціле, min 0, defaultValue 0, лише читання,
     label і description зі словника). Відсутнє поле в наявних документах трактуй як 0
     в усіх сирих запитах ($ifNull).
  2. У stockLedger.service.ts додай:
     - reserve(req, lines): лінії зводяться за {product, warehouse} і сортуються як
       byProductAndWarehouse; для кожної умовний updateOne з
       $expr: qty − ifNull(reserved,0) ≥ n і $inc reserved n. Нестачі збираються по всіх рядках
       і кидаються одним InsufficientStockError, де available = qty − reserved (не менше 0).
     - release(req, lines): $inc reserved −n з умовою reserved ≥ n; невдача — Error про розсинхрон
       кешу (транзакція відкотиться), без тихої корекції.
  3. decreaseBalances отримує режим перевірки: 'available' (qty − reserved ≥ n) за замовчуванням
     і 'physical' (qty ≥ n). issue/issueWithoutMoves/transfer/revert використовують 'available';
     issue приймає опцію { allowBelowReserved: true }, яку передає лише списання з інвентаризації
     (StockAdjustments). assertAvailable рахує qty − reserved.
  4. Тести (новий tests/int/stockReservation.int.spec.ts): reserve/release змінюють лише reserved;
     reserve понад доступне кидає повний список нестач; release понад резерв кидає помилку;
     issue і transfer не беруть зарезервоване; списання з інвентаризації дозволене нижче резерву,
     але не нижче 0; паралельні reserve на останню одиницю — успішний рівно один.
  Замовлення в цій задачі не чіпай.
  ```

- [x] **R2. Перевірка кешу резерву.**
  Складність: S. Модель: **Sonnet 5.5**.
  Файли: `src/endpoints/stockCacheCheck.ts`, тест `stockCacheCheck` (наявний або новий).

  ```text
  Задача R2 (В23): stockCacheCheck звіряє stock-balances.reserved із сумою
  accounting.reservedItems замовлень у статусах pending і paid (group за product, warehouse).
  Додай тип розбіжності { type: 'reserved', product, warehouse, expectedReserved, actualReserved }
  у звіт і в режим перебудови (rebuild виставляє reserved = expected, відсутнє — 0).
  Поле reservedItems може ще не існувати в схемі замовлень (з'явиться в R3): читай сирою
  агрегацією по колекції orders. Тести: розбіжність знаходиться й виправляється; без резервів
  звіт порожній.
  ```

- [ ] **R3. Поля замовлення, статус backorder, налаштування строку.**
  Складність: S. Модель: **Sonnet 5.5**.
  Файли: `src/collections/Orders/index.ts`, `src/collections/Orders/types/custom-order.ts`,
  `src/globals/AccountingSettings.ts`, `src/i18n/{en,ru,ro}.ts`, `src/i18n/pluginEcommerce.ts` (якщо статуси там).

  ```text
  Задача R3 (В23): лише схема, без логіки.
  1. Orders.status: додай опцію backorder між pending і paid (label custom:status:backorder:
     en «Backorder», ru «Под заказ», ro «La comandă»).
  2. У групі accounting замовлення: reservedItems (array: product rel products, warehouse rel
     warehouses, qty number), reservedAt (date), shortages (array: product, warehouse, requested,
     available). Усі readOnly в адмінці, update через API заборонено (access як інших облікових полів),
     видно admin і manager. Хуки, що зараз скидають облікові поля з тіла запиту, мають скидати й ці.
  3. accounting-settings: reservationDays (number, ціле, min 1, необов'язкове), label/description
     зі словника: «Скільки днів тримати резерв до сповіщення; порожньо — без контролю».
  4. Оновити тип у custom-order.ts. generate:types. Тест паритету i18n має бути зеленим.
  Тест: тіло REST-запиту з reservedItems/shortages/reservedAt ігнорується при create і update.
  ```

- [ ] **R4. Резерв при створенні, зміні та відвантаженні; автоматичний backorder.**
  Складність: L. Модель: **Opus 5.5**.
  Файли: `src/collections/Orders/hooks/deductOrderStock.ts` (перейменувати на `postOrderStock.ts`),
  `src/collections/Orders/index.ts`, `src/services/orders/orderState.ts`,
  `src/collections/Orders/endpoints/createOrder.ts` (лише якщо потрібно), тести `orderStock`, `createOrder`.

  ```text
  Задача R4 (В23). Перейменуй deductOrderStock на postOrderStock (і файл, і імпорти,
  ORDER_STOCK_MOVES_CONTEXT_KEY лишається). Порядок у beforeChange не змінюй.
  Резервує лише облікове замовлення (isOrderAwaitingPosting) при stockControlEnabled.
  У orderState.ts додай isOrderReserving(order) = awaiting posting && status in [pending, paid]
  і hasReservation(order) = reservedItems не порожній.
  Логіка (усе в транзакції req):
  - create, status pending/paid: reserve(позиції, склад). Успіх → reservedItems, reservedAt = now,
    shortages = []. InsufficientStockError: якщо source = web — кинути далі (409 як зараз,
    assertAvailable для сайту більше не потрібен); інакше status = backorder,
    shortages = нестачі (повний список рядків з нестачею), reservedItems = [], reservedAt = null.
  - create, status backorder: shortages рахуються перевіркою без резерву, резерву немає.
  - create, status shipped: як зараз.
  - update pending/paid без зміни статусу, змінились позиції або склад: release(старий знімок),
    reserve(нові), reservedAt без змін. Нестача → APIError 409 з текстом нестач (shortageMessage),
    статус не змінюється.
  - backorder → pending/paid: reserve всіх позицій; успіх → знімок, reservedAt = now, shortages = [];
    нестача → APIError 409 з переліком (shortages в БД не оновлюються, бо транзакція відкотиться).
  - pending/paid → backorder: release, знімок очищено, shortages перераховано перевіркою.
  - update backorder з новими позиціями: перерахувати shortages, резерву немає.
  - → shipped з pending/paid: release(знімок), потім issueWithoutMoves (перевірка available),
    знімок очищено. backorder → shipped: APIError 409 custom:error:backorderNotShippable.
  - Замовлення з reservedItems при вимкненому обліку: при відвантаженні чи зміні знімок усе одно
    знімається (резерв керується знімком, не налаштуванням).
  Тексти помилок через customT(req.t), нові ключі в en/ru/ro.
  Тести: два замовлення сайту на весь залишок — друге 409; адмінське при нестачі стає backorder
  з shortages; backorder → pending успіх і відмова; pending → backorder знімає резерв; зміна
  кількості й складу переносить резерв, нестача відкочує зміну; відвантаження зменшує qty і reserved,
  чуже замовлення не відвантажує зарезервоване; backorder → shipped відхилено.
  Скасування й видалення — у R5, права manager — у R6.
  ```

- [ ] **R5. Скасування й видалення знімають резерв.**
  Складність: S. Модель: **Opus 5.5**.
  Файли: `src/collections/Orders/hooks/cancelOrderStock.ts`, `src/collections/Orders/hooks/forbidDeletePosted.ts`
  (або новий `releaseOrderReservation.ts` у `beforeDelete`), тести `orderCancel`.

  ```text
  Задача R5 (В23). У prepareOrderCancel: для непроведеного замовлення з reservedItems викликай
  release(знімок) і очищай reservedItems, reservedAt (у data). backorder скасовується без змін складу.
  Проведене — як зараз (revert рухів sale). Видалення непроведеного: після перевірок
  forbidDeletePosted знімай резерв у beforeDelete тієї самої транзакції (окремим хуком
  releaseOrderReservation, що йде після forbidDeletePosted). Помилка release відкочує
  скасування/видалення.
  Тести: скасування pending повертає доступне й нове замовлення проходить; скасування backorder
  не змінює stock-balances; видалення pending знімає резерв; відхилене скасування (оплачене гостьове)
  резерв не знімає.
  ```

- [ ] **R6. Переходи статусів і права manager.**
  Складність: S. Модель: **Opus 5.5**.
  Файли: `src/collections/Orders/hooks/guardManagerOrderUpdate.ts`, `src/collections/Orders/hooks/guardPostedOrder.ts`,
  `src/services/orders/orderState.ts`, i18n, тести `orderManager`, `guardPostedOrder`.

  ```text
  Задача R6 (В23). Manager може змінювати статус лише так: pending → shipped,
  backorder → pending, pending → backorder (у тому самому збереженні, що й правки, як у В21).
  Решта — admin. isOrderEditable включає backorder (неоплачене, непроведене).
  guardPostedOrder: backorder → shipped заборонено (якщо R4 цього ще не робить, тримай перевірку
  в одному місці). Онови текст custom:error:managerOrderTransition в en/ru/ro.
  Тести: матриця переходів для manager і admin; manager редагує позиції backorder-замовлення.
  ```

- [ ] **R7. Сайт і залишки: доступна кількість.**
  Складність: S. Модель: **Sonnet 5.5**.
  Файли: `src/collections/Products/services/productsByRelation.service.ts` (`loadInStock`),
  `src/endpoints/getProductStock.ts`, `src/services/reports/stock.service.ts`, тести `productInStock`, `productStock`.

  ```text
  Задача R7 (В23). loadInStock: inStock = qty − ifNull(reserved,0) > 0 на defaultWebWarehouse
  (запит через where не вміє різницю — використай сиру агрегацію в сесії req або вибірку qty і
  reserved з фільтром у коді; кількість товарів на сторінці мала). getProductStock: по кожному
  складу qty, reserved, available і totalReserved/totalAvailable. Звіт залишків: колонки
  «Зарезервовано» і «Доступно», ознака перепродажу, якщо reserved > qty. i18n в en/ru/ro.
  Тести: товар з усім залишком у резерві має inStock false; getProductStock повертає reserved
  і available; manager не бачить собівартості, як і раніше.
  ```

- [ ] **R8. Строк резерву: віджет, банер, фільтр.**
  Складність: M. Модель: **Sonnet 5.5**.
  Файли: новий `src/services/orders/reservationExpiry.ts`, новий ендпоінт
  `src/endpoints/reservationSummary.ts`, компоненти в `src/components/ReservationWidget/` і
  `src/collections/Orders/components/ReservationBanner.tsx`, `src/payload.config.ts` (віджет), `Orders/index.ts`, i18n.

  ```text
  Задача R8 (В23). Фонові задачі не потрібні, все рахується на льоту.
  1. reservationExpiry.ts: expiryDate(reservedAt, days), isReservationExpired(order, days, now).
  2. GET /api/orders/reservation-summary (admin і manager, інакше 401/403, D7): кількість
     прострочених резервів (status pending/paid, reservedItems не порожній,
     reservedAt < now − reservationDays; якщо reservationDays порожнє — 0), кількість backorder,
     кількість позицій stock-balances з reserved > qty, і по 10 найстаріших прострочених
     (id, orderNumber, reservedAt).
  3. Віджет дашборда «Резерви» поруч із collection-icons: три лічильники з посиланнями на
     список замовлень з відфільтрованим where (status, accounting.reservedAt less_than дата) і на
     звіт залишків. Тексти через useTranslation, ключі зі словника.
  4. Банер у формі замовлення (UI-поле в групі accounting або beforeDocumentControls): «Строк
     резерву минув DD.MM» для простроченого; для backorder — список shortages з назвами товарів.
  Тести: сервіс строку (межі: рівно N днів, порожнє налаштування, backorder без резерву);
  ендпоінт summary з правами.
  ```

- [ ] **R9. Міграція наявних замовлень.**
  Складність: M. Модель: **Opus 5.5**.
  Файли: нова міграція в `src/migrations/` (+ `index.ts`), тест міграції.

  ```text
  Задача R9 (В23). Міграція Payload (up/down) у транзакції:
  1. stock-balances: reserved = 0 там, де поля немає.
  2. Облікові замовлення (stockTracked = true, stockPostedAt = null) у pending/paid, від
     найстарішого createdAt: зведи позиції за товаром на складі замовлення; якщо доступно
     (qty − reserved) — reserve, reservedItems, reservedAt = createdAt; інакше status = backorder,
     shortages. Історичні й проведені замовлення не чіпай.
  3. Виведи звіт у logger: скільки зарезервовано, скільки переведено в backorder (номери).
  down: reserved = 0, поля reservedItems/reservedAt/shortages прибрати, backorder → pending.
  Перед запуском на проді — резервна копія БД (як у D4). Після — stockCacheCheck без розбіжностей.
  Тест на cosmetics_test: суміш замовлень із достатнім і недостатнім залишком.
  ```

- [ ] **R10. Документація.**
  Складність: XS. Модель: **Sonnet 5.5**.
  Файли: `docs/decisions.md` (статус В23 → виконано), `docs/accounting/frontend-stock-notes.md`,
  `docs/accounting/runbook.md`.

  ```text
  Задача R10 (В23). Познач В23 «прийнято, виконано» і запиши в журнал змін. У
  frontend-stock-notes.md онови розділи 1 і 4 за docs/accounting/frontend-reservation-notes.md
  (inStock тепер враховує резерв, 409 рахує вільний залишок, новий статус backorder у /api/orders/my).
  У runbook.md: як запускати міграцію R9, як читати віджет «Резерви», що робити з перепроданими
  позиціями й простроченими резервами, як stockCacheCheck перевіряє reserved. Код не змінюй.
  ```

---

## Ручна перевірка перед продом

- [ ] Створити замовлення з адмінки на залишок, якого бракує: воно стає «Під замовлення» з переліком нестач.
- [ ] Оприбуткувати закупівлю, перевести замовлення в «Очікує»: товар резервується, і `inStock` на сайті змінюється.
- [ ] Відвантажити замовлення: `qty` і `reserved` зменшуються на ту саму кількість.
- [ ] Скасувати замовлення в `pending`: доступна кількість повертається.
- [ ] Поставити `reservationDays = 1` і перевірити, що у вчорашнього замовлення є віджет і банер.
- [ ] Перевірити права manager: його дозволені переходи працюють, скасування відхиляється.
- [ ] Після міграції `stockCacheCheck` показує 0 розбіжностей.
