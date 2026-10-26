# Товарний і фінансовий облік: дизайн

Дата: 2026-10-24. Статус: проєкт, код не писався.
Джерела: `CLAUDE.md`, `docs/decisions.md`, `docs/plan.md` (рішення, підсумок), код Orders,
Products, Users, `src/plugins/index.ts`, `src/payload.config.ts`, `promo.service.ts`, тести `tests/int`.

## 0. Факти з коду, на яких стоїть дизайн

| # | Факт | Де | Наслідок для дизайну |
|---|------|----|----------------------|
| F1 | Валюта MDL з `decimals: 0`; ціна позиції округлюється `Math.round`, `total` і `discount` цілі | `plugins/index.ts`, `createOrder.ts:96,109` | Продажі в цілих лей. Закупівлі мають бані, тому нові суми зберігаємо в цілих банях (розд. 5) |
| F2 | `inventory` це поле плагіна типу `number` на Products. Сховане в адмінці (`hideStockFields`), виключене з `getSingleProduct`, `searchProducts`, `getBestSellers`, `getFavorites`. Ніде не читається й не списується | grep по `src` | Джерело правди для залишку буде новим; `inventory` не чіпаємо (розд. 4.5) |
| F3 | Позиція кошика й замовлення має лише `product`, без варіанта. Поля `variants`/`enableVariants` є від плагіна, але в продажах не беруть участі | `Orders/index.ts:53-93`, `Carts` | Облікова одиниця = товар. Варіанти не підтримуємо (припущення П3) |
| F4 | Ролі: `admin`, `customer` (select `roles`, hasMany). `access.admin` у Users пускає лише admin | `Users/index.ts:24,131-153` | Додати `manager`, розширити `access.admin` |
| F5 | Статуси замовлення `pending, paid, shipped, cancelled`; `paymentType: cash/transfer` | `Orders/index.ts:104-115` | Статуси лишаються; оплата обліковується окремо (розд. 6) |
| F6 | `populatePricesAndTotal` працює на **кожному** `beforeChange`, зокрема на update: перераховує ціни з поточного каталогу і затирає брендову знижку оптовика (зафіксовано тестом `createOrderPricing`) | `populatePricesAndTotal.ts` | Без змін виручка проведеного замовлення «пливе» при будь-якому редагуванні статусу. Потрібен захист (розд. 9, задача S2.1) |
| F7 | `createOrder` відкриває транзакцію, лічильник номера йде **поза** транзакцією (`counters`, `$inc`), сповіщення після коміту | `createOrder.ts`, `setOrderNumber.ts` | Ту саму схему беремо для нових номерів; списання кладемо в хук Orders, щоб воно було в цій же транзакції |
| F8 | `shippingAddress.*` усі `required` на рівні схеми | `Orders/index.ts:120-130` | Продаж у «Магазині» без адреси неможливий. Потрібне умовне `required` (розд. 9.3) |
| F9 | `customer` може бути порожнім (гість); `user?.id` | `createOrder.ts:122` | Знімок менеджера для гостя порожній (розд. 7) |
| F10 | Products має `versions.drafts`; `retailPrice` required, `wholesalePrice` читає admin або оптовик | `Products/index.ts` | Залишки посилаються на id товару, драфти не впливають |
| F11 | `checkRole` типізовано через `User['roles']` | `access/utilities.ts` | Після додавання ролі потрібен `generate:types` |

## 1. Огляд архітектури

```
Довідники            Документи (номер, статус)               Журнали (append-only)    Кеш залишків
warehouses           purchases          ─┐                    stock-moves  ──────────> stock-balances (товар×склад: qty)
suppliers            stock-transfers     ├─ проведення ─────> (qty, value)  ─────────> product-costs  (товар: qty, value)
cash-accounts        stock-adjustments   │   (хуки, txn)
expense-categories   opening-balances    │
salary-schemes       orders (продаж)    ─┤
                     cash-operations    ─┼─────────────────> cash-moves   ──────────> cash-accounts.balanceBani
                     payrolls           ─┘
Глобал: accounting-settings      Лічильники: counters (наявна колекція MongoDB)
```

Принципи:
1. Журнали лише доповнюються. Сторно пише компенсуючі рядки, а не видаляє.
2. Кеш (`stock-balances`, `product-costs`, `balanceBani`) змінюється тільки в тій самій транзакції, що й журнал; завжди відновлюється з журналу (задача перерахунку).
3. Проведення відбувається в хуку колекції при переході статусу, а не окремим ендпоінтом. Це дає одну точку для адмінки, REST і Local API.
4. Усі виклики Local API з `req`; сирі операції MongoDB (умовний `$inc`) з сесією транзакції `req`.

## 2. Модель даних

Позначення: `R` required, `RO` readOnly в адмінці, `idx` індекс, `uniq` унікальний.
Гроші: суфікс `Bani` = ціле число банів (1 MDL = 100 бані). Кількість: ціле число штук.

### 2.1 Довідники

**`warehouses`** (група «Склад»)
| Поле | Тип | Примітка |
|---|---|---|
| name | text R | «Основний», «Магазин» |
| code | text R uniq | `main`, `shop`; стабільний ключ для налаштувань |
| isActive | checkbox | неактивний не можна обрати в нових документах |
| sortOrder | number | |

**`suppliers`** (група «Закупівлі»)
| Поле | Тип | Примітка |
|---|---|---|
| name | text R idx | |
| idno | text | фіскальний код (лише довідково) |
| phone, email, contactPerson | text | |
| bankDetails | textarea | |
| isCarrier | checkbox | перевізник; може бути платником логістики в накладній |
| isActive | checkbox | |
| notes | textarea | |

**`cash-accounts`** (група «Фінанси»)
| Поле | Тип | Примітка |
|---|---|---|
| name | text R | «Каса готівка», «Рахунок компанії» |
| code | text R uniq | `cash`, `bank` |
| kind | select R | `cash` / `bank` |
| balanceBani | number RO | кеш; змінюється тільки проведенням |
| allowNegative | checkbox | за замовчуванням false |
| isActive | checkbox | |

**`expense-categories`** (група «Фінанси»)
| Поле | Тип | Примітка |
|---|---|---|
| name | text R | оренда, хостинг, зарплата, реклама, банк. комісії, інше |
| code | text R uniq | |
| isSalary | checkbox | стаття зарплати: вимагає `manager` в операції |
| isActive | checkbox | |

**Глобал `accounting-settings`**
| Поле | Тип | Примітка |
|---|---|---|
| stockControlEnabled | checkbox | вимикач проведення замовлень (розд. 10). До запуску false |
| accountingStartAt | date RO | момент запуску, ставиться разом із вмиканням |
| defaultWebWarehouse | rel warehouses R | склад для публічного `createOrder` |
| defaultAdminWarehouse | rel warehouses | підставляється в адмінці, напр. «Магазин» |
| lockedUntil | date | закритий період: проведення й сторно з датою ≤ цієї заборонені |
| assignOrderToCreatorIfNoManager | checkbox | правило G (розд. 7) |
| defaultCustomerAccount | rel cash-accounts | підказка для надходжень |

### 2.2 Документи складу й закупівель

Спільні поля документа (далі «шапка»):
| Поле | Тип | Примітка |
|---|---|---|
| number | text RO uniq | `PUR-000001` тощо, з лічильника (розд. 8) |
| status | select R | `draft` / `posted` / `reversed` |
| documentDate | date R | дата документа постачальника, довідково |
| postedAt | date RO | момент проведення = дата обліку |
| postedBy | rel users RO | |
| reversedAt, reversedBy | RO | |
| reversalReason | textarea | обов'язкове при сторно |
| comment | textarea | |

**`purchases`** — приходна накладна
| Поле | Тип | Примітка |
|---|---|---|
| (шапка) | | префікс `PUR` |
| supplier | rel suppliers R idx | |
| supplierInvoiceNo | text | номер накладної постачальника |
| warehouse | rel warehouses R | одна накладна = один склад |
| allocationBase | select R | `amount` (за замовч.) / `quantity` |
| lines[] | array R min 1 | |
| ├ product | rel products R | |
| ├ quantity | number R, int > 0 | |
| ├ unitPriceBani | number R ≥ 0 | ціна постачальника |
| ├ amountBani | number RO | `quantity × unitPriceBani` |
| ├ allocatedBani | number RO | частка логістики |
| ├ landedBani | number RO | `amountBani + allocatedBani` |
| └ landedUnitCost | number RO | `landedBani / quantity`, дробове, лише показ |
| extraCosts[] | array | логістика, мито, пакування |
| ├ description | text R | |
| ├ amountBani | number R > 0 | |
| └ payee | rel suppliers R | кому винні: той самий постачальник або перевізник |
| goodsTotalBani, extraTotalBani, landedTotalBani | number RO | |

Індекси: `{supplier, status, postedAt}`, `{status, postedAt}`.

**`stock-transfers`** — переміщення (`TRF`)
| Поле | Тип | Примітка |
|---|---|---|
| (шапка) | | |
| fromWarehouse, toWarehouse | rel warehouses R | різні |
| lines[]: product R, quantity R int > 0 | | |

**`stock-adjustments`** — списання та інвентаризація (`ADJ`)
| Поле | Тип | Примітка |
|---|---|---|
| (шапка) | | |
| kind | select R | `writeoff` / `inventory` |
| warehouse | rel warehouses R | |
| reason | select | для writeoff: `damage`, `expired`, `tester`, `internal`, `other` |
| lines[] | | |
| ├ product | R | |
| ├ quantity | int > 0 | writeoff: скільки списати |
| ├ countedQty | int ≥ 0 | inventory: фактична кількість |
| ├ expectedQty | RO | inventory: облікова на момент проведення |
| ├ diffQty | RO | `countedQty − expectedQty` |
| ├ unitCostBani | number | inventory: обов'язкова, якщо надлишок по товару з нульовим залишком |
| └ valueBani | RO | вартість зміни |

Інвентаризація: тільки товари з рядків (часткова). Повна = імпорт усіх товарів складу в рядки (кнопка/скрипт, необов'язково).

**`opening-balances`** — початкові залишки (`OPN`)
| Поле | Тип | Примітка |
|---|---|---|
| (шапка) | | |
| kind | select R | `stock` / `cash` / `supplierDebt` / `customerDebt` |
| stockLines[]: warehouse R, product R, quantity int > 0, unitCostBani R > 0 | | kind=stock |
| cashLines[]: account R, amountBani R | | kind=cash |
| supplierLines[]: supplier R, amountBani R (± ; мінус = аванс) | | kind=supplierDebt |
| customerLines[]: order R, amountBani R > 0 | | kind=customerDebt, лише історичні замовлення |

### 2.3 Журнали й кеш

**`stock-moves`** (append-only, створюється тільки кодом; у адмінці лише перегляд)
| Поле | Тип | Примітка |
|---|---|---|
| date | date R idx | = postedAt документа або дата сторно |
| product | rel products R | |
| variant | rel variants | резерв, завжди порожнє (П3) |
| warehouse | rel warehouses R | |
| qtyDelta | number R | + прихід, − витрата |
| valueDeltaBani | number R | зміна вартості за середньою; для переміщень 0 |
| unitCostBani | number | знімок середньої на момент руху, довідково |
| moveType | select R | `opening`, `purchase`, `sale`, `sale_cancel`, `transfer_out`, `transfer_in`, `writeoff`, `inventory`, `reversal` |
| docCollection | text R | `purchases`, `orders`, … |
| docId | text R | |
| docNumber | text | для списків |
| reversalOf | rel stock-moves | для сторно |

Індекси: `{product, warehouse, date}`, `{docCollection, docId}`, `{date, moveType}`.

**`stock-balances`** (кеш, один документ на товар×склад)
| Поле | Тип |
|---|---|
| product | rel products R |
| variant | rel variants (резерв) |
| warehouse | rel warehouses R |
| qty | number R ≥ 0 |
| updatedAt | auto |

Індекс `uniq {product, variant, warehouse}`.

**`product-costs`** (кеш середньої, один документ на товар)
| Поле | Тип | Примітка |
|---|---|---|
| product | rel products R uniq | |
| qty | number | сума qty по всіх складах |
| valueBani | number | вартість усього залишку |
| avgCostBani | number RO | `valueBani / qty`, обчислюване, дробове, тільки показ |
| lastPurchaseUnitCostBani | number | довідково |

Інваріант: `product-costs.qty = Σ stock-balances.qty` для товару; `qty = 0 ⇒ valueBani = 0`.

### 2.4 Фінанси

**`cash-operations`** (`CSH`)
| Поле | Тип | Примітка |
|---|---|---|
| (шапка без documentDate; є `operationDate`) | | |
| type | select R | `customer_receipt`, `customer_refund`, `supplier_payment`, `expense`, `transfer` |
| account | rel cash-accounts R | звідки/куди |
| toAccount | rel cash-accounts | лише transfer |
| amountBani | number R > 0 | |
| order | rel orders | R для customer_receipt/customer_refund |
| customer | rel users RO | копія з замовлення, для звітів |
| supplier | rel suppliers | R для supplier_payment |
| purchase | rel purchases | довідково |
| category | rel expense-categories | R для expense |
| manager | rel users | R, якщо category.isSalary |
| payroll | rel payrolls | довідково при виплаті зарплати |

Індекси: `{type, status, operationDate}`, `{order}`, `{supplier}`, `{manager, category}`.

**`cash-moves`** (append-only)
| Поле | Тип |
|---|---|
| date | date R |
| account | rel cash-accounts R |
| deltaBani | number R (+/−) |
| operation | rel cash-operations / opening-balances (docCollection, docId) |
| reversalOf | rel cash-moves |

Індекс `{account, date}`.

### 2.5 Менеджери й зарплата

**Users** (додаються поля)
| Поле | Тип | Доступ |
|---|---|---|
| roles | + опція `manager` | як зараз (admin) |
| manager | rel users, filterOptions: roles contains manager | read: admin, manager; update: admin |

**Orders** (додаються поля, нічого не видаляється)
| Поле | Тип | Доступ read |
|---|---|---|
| source | select `web` / `admin` RO | admin, manager |
| warehouse | rel warehouses | admin, manager; update лише на create |
| manager | rel users RO | знімок; admin, manager |
| createdBy | rel users RO | admin, manager |
| accounting (group, RO) | | **тільки admin** |
| ├ stockPostedAt | date | є ⇒ замовлення проведене й списало залишок |
| ├ cogsBani | number | собівартість на момент списання |
| ├ revenueBani | number | `round(total × 100)` на момент створення |
| └ cancelledAt | date | |
| paidBani | number RO | Σ надходжень − повернень; admin, manager, власник замовлення |
| paymentState | select RO `unpaid`/`partial`/`paid` | те саме |

Індекси: `{manager, createdAt}`, `{accounting.stockPostedAt}`, `{status}`.

**`salary-schemes`** (група «Фінанси»)
| Поле | Тип | Примітка |
|---|---|---|
| name | text R | |
| manager | rel users | порожньо = схема за замовчуванням для всіх менеджерів |
| validFrom, validTo | date | |
| fixedBani | number | оклад за період |
| percent | number (0–100, 2 знаки) | |
| base | select R | `revenue` (виручка), `gross_profit` (виручка − собівартість), `paid_revenue` (лише повністю оплачені) |
| dateBasis | select R | `order_date` (stockPostedAt) / `payment_date` (дата останньої оплати) |
| attribution | select R | `snapshot` (Orders.manager) / `current` (поточний Users.manager клієнта) |
| customerFilter | select | `all` / `retail` / `wholesale` |
| period | select | `month` (поки єдине) |

**`payrolls`** — розрахунок зарплати (`PAY`)
| Поле | Тип | Примітка |
|---|---|---|
| (шапка) | | |
| manager | rel users R | |
| periodFrom, periodTo | date R | |
| scheme | rel salary-schemes R | |
| schemeSnapshot | json RO | копія параметрів на момент розрахунку |
| lines[] RO | order, orderNumber, baseBani, amountBani | |
| baseTotalBani, percentAmountBani, fixedBani, totalBani | RO | |
| adjustmentsBani | number | ручна корекція (премія, штраф), з коментарем |
| paidBani | RO | Σ витрат зі статтею isSalary і `payroll` = цей |

Статуси payroll: `draft` (перераховується при кожному збереженні) → `posted` (затверджено, незмінний) → `reversed`.

## 3. Життєвий цикл документів і правила проведення

### 3.1 Загальні правила (усі документи, крім Orders)

| Перехід | Хто | Що відбувається (в одній транзакції `req`) |
|---|---|---|
| створити `draft` | admin | номер із лічильника; поля редагуються вільно |
| `draft → posted` | admin | валідація; запис журналів; оновлення кешу; `postedAt = now`, `postedBy` |
| `posted → reversed` | admin | обов'язкова `reversalReason`; компенсуючі рядки журналу з `date = now`, `reversalOf`; оновлення кешу |
| `draft` видалити | admin | дозволено |
| `posted`/`reversed` видалити | нікому | `beforeDelete` кидає помилку |
| змінити будь-що в `posted`, крім переходу в `reversed` | нікому | `beforeChange` кидає помилку |
| `reversed → *` | нікому | кінцевий стан; виправлення новим документом |
| будь-яка дата обліку ≤ `lockedUntil` | нікому | помилка «період закрито» |

Дата обліку завжди = момент проведення (сервер). Заднім числом не проводимо: середня рахується в порядку проведення, а не `documentDate` (П6).

### 3.2 Правила проведення за типами

| Документ | Проведення | Сторно |
|---|---|---|
| purchases | розподіл логістики (розд. 5.2); для кожного рядка: `stock-balances[product, warehouse].qty += q`; `product-costs: qty += q, valueBani += landedBani`; рух `purchase` | для кожного рядка умовно `qty -= q` на складі накладної (немає залишку ⇒ помилка «товар уже продано, сторно неможливе»); `valueBani -= landedBani`; якщо нова `qty = 0` ⇒ `valueBani = 0`; якщо `valueBani < 0` при `qty > 0` ⇒ помилка, потрібна інвентаризаційна корекція |
| stock-transfers | `from.qty -= q` (умовно, без нестачі), `to.qty += q`; `product-costs` не змінюється; два рухи з `valueDelta = 0` | дзеркально: `to.qty -= q` (умовно), `from.qty += q` |
| stock-adjustments writeoff | `qty -= q` (умовно); `value = round(valueBani × q / qty)`; рух `writeoff` | повернення тієї самої `value` і `q` |
| stock-adjustments inventory | `expectedQty` = поточний залишок на момент проведення; `diff < 0` як writeoff за середньою; `diff > 0`: прихід за поточною середньою, а якщо `product-costs.qty = 0`, то за `unitCostBani` рядка (обов'язкова) | дзеркально з тими самими значеннями |
| opening-balances stock | як прихід, вартість `quantity × unitCostBani`; рух `opening` | як сторно приходу |
| opening-balances cash | `cash-moves +amount`; `balanceBani += amount` | дзеркально |
| opening-balances supplier/customerDebt | лише документ, журналу немає; враховується у звіті боргів | статус `reversed` прибирає зі звіту |
| cash-operations | розд. 6.2 | компенсуючі `cash-moves`, `balanceBani` назад; для оплат замовлень перерахунок `paidBani` |
| payrolls | фіксує рядки й суму | дозволено, лише якщо немає виплат (paidBani = 0) |

Хто сторнує: тільки admin (рекомендація, питання В5).

## 4. Модель залишків

### 4.1 Рішення

Append-only журнал `stock-moves` + кеш `stock-balances` (товар×склад) і `product-costs` (товар).
Кеш потрібен, бо заборона нестачі вимагає атомарного умовного списання; похідний залишок (агрегація журналу) цього не дає без блокувань.

### 4.2 Атомарне умовне списання (псевдокод)

```
session = payload.db.sessions[await req.transactionID]   // сесія тієї ж транзакції
for line in lines (відсортовані за product id, щоб уникати взаємних блокувань):
  res = stockBalances.updateOne(
          { product, variant: null, warehouse, qty: { $gte: line.qty } },
          { $inc: { qty: -line.qty } },
          { session })
  if res.modifiedCount == 0:
     shortages.push({ product, requested: line.qty, available: current qty або 0 })
if shortages: throw InsufficientStockError(shortages)          // відкат усієї транзакції

pc = productCosts.findOne({ product }, { session })
cogs = round(pc.valueBani * q / pc.qty)                       // q ≤ pc.qty гарантовано
productCosts.updateOne({ product, qty: pc.qty, valueBani: pc.valueBani },   // оптимістична умова
                       { $inc: { qty: -q, valueBani: -cogs } }, { session })
  -> modifiedCount 0 ⇒ ConcurrentUpdateError ⇒ повтор транзакції
stockMoves.create(... , req)                                  // Local API з req
```

Обидва паралельні замовлення на останню одиницю: одне проходить умову `$gte`, друге отримує `modifiedCount = 0` або `WriteConflict` від MongoDB. В обох випадках друге не створюється.

Повтори: `createOrder` і проведення документів повторюють транзакцію до 3 разів на `TransientTransactionError`/`WriteConflict`/`ConcurrentUpdateError`. Номер з лічильника при повторі береться новий: пропуск допустимий (відповідь власника 7).

### 4.3 З якого складу списується замовлення

| Шлях | Склад |
|---|---|
| публічний `createOrder` (гість або клієнт) | `accounting-settings.defaultWebWarehouse`; значення з тіла запиту ігнорується |
| адмінка (admin/manager) | поле `warehouse`, за замовчуванням `defaultAdminWarehouse`; змінюється лише при створенні |
| `stockControlEnabled = false` | списання немає, `accounting.stockPostedAt` порожнє |

Одне замовлення = один склад (часткових відвантажень немає).

### 4.4 Перерахунок кешу

Ендпоінт/скрипт `rebuild-stock-cache` (admin): агрегує `stock-moves` за `{product, warehouse}` і порівнює з кешем; режим `check` (звіт розбіжностей) і `fix`. Запускати після міграцій і як нічну перевірку (необов'язково).

### 4.5 Сумісність із `inventory` і фронтендом

- `inventory` (F2) не змінюємо й не використовуємо: воно приховане, кастомні ендпоінти його не віддають. Синхронізація з ним створила б друге джерело правди.
- Фронтенду додаємо поля (лише додавання): у `getSingleProduct`, `searchProducts`, списках за брендом/категорією, `getBestSellers` — `inStock: boolean` (залишок на `defaultWebWarehouse` > 0). Кількість не показуємо (питання В4).
- `unavailable` лишається ручним прапорцем. Авто-виставлення при нулі не робимо без рішення (В4).
- `createOrder` при нестачі повертає **409** `{ success: false, code: 'INSUFFICIENT_STOCK', message, items: [{ product, requested, available }] }`. Нині будь-яка помилка дає 500, тож це новий код відповіді; формат успішної відповіді не змінюється.

## 5. Гроші й собівартість

### 5.1 Зберігання й округлення

| Що | Одиниця | Округлення |
|---|---|---|
| Ціни каталогу, `orders.items.price`, `total`, `discount` | цілі MDL (як зараз, F1) | не змінюємо |
| Усі нові грошові поля (`*Bani`) | цілі бані | на кожній операції до цілого бана, `Math.round` (half-up для додатних) |
| Перехід з замовлення в облік | `revenueBani = Math.round(total × 100)` | |
| Середня собівартість | не зберігається окремо: `valueBani / qty` | вартість списання `round(valueBani × q / qty)`; останнє списання забирає рівно залишок вартості, тож дрейфу немає |
| Відсоток зарплати | `round(base × percent / 100)` на рядок замовлення | сума рядків = підсумок |

Адмінка: спільний компонент `MoneyField` (за зразком наявного `PriceField`) показує й приймає MDL з двома знаками, записує бані. Без нових залежностей.

### 5.2 Розподіл логістики на рядки

База: `amount` (вартість рядка, за замовчуванням) або `quantity` (штуки). Метод: найбільших залишків у банях.

```
L = Σ extraCosts.amountBani
w_i = amountBani_i (або quantity_i);  W = Σ w_i
raw_i = L × w_i / W;   alloc_i = floor(raw_i)
rest = L − Σ alloc_i            // 0 ≤ rest < кількість рядків
+1 бан рядкам з найбільшою дробовою частиною raw_i; нічия ⇒ більший w_i, далі менший індекс рядка
landedBani_i = amountBani_i + alloc_i
```

Приклад: логістика 150,00 MDL = 15 000 бані.

| Рядок | К-сть | Ціна, MDL | Сума, бані | raw (база amount) | floor | +залишок | alloc | landedBani | Посадочна за шт., MDL |
|---|---|---|---|---|---|---|---|---|---|
| A | 10 | 120,00 | 120 000 | 7 734,6167 | 7 734 | +1 | 7 735 | 127 735 | 127,7350 |
| B | 5 | 75,50 | 37 750 | 2 433,1815 | 2 433 | | 2 433 | 40 183 | 80,3660 |
| C | 3 | 249,90 | 74 970 | 4 832,2018 | 4 832 | | 4 832 | 79 802 | 266,0067 |
| Σ | 18 | | 232 720 | 15 000 | 14 999 | 1 | 15 000 | 247 720 | |

Та сама накладна з базою `quantity`: raw = 8 333,33 / 4 166,67 / 2 500,00 → floor 8 333 / 4 166 / 2 500, залишок 1 бан іде B (дробова 0,67) → 8 333 / 4 167 / 2 500.

### 5.3 Середньозважена: одна на товар

Рекомендація: **одна середня на товар** для всіх складів. Причини: склади належать одній компанії, переміщення без витрат; інакше переміщення мусило б переносити вартість і множити розрахунки. Переміщення середню не змінюють.

Приклад (товар A, продовження 5.2):

| Подія | qty | valueBani | Середня, MDL | Собівартість операції |
|---|---|---|---|---|
| Початковий залишок | 4 | 46 000 | 115,0000 | |
| Прихід 10 шт. (landed 127 735) | 14 | 173 735 | 124,0964 | |
| Продаж 3 шт. | 11 | 136 506 | 124,0964 | `round(173735×3/14)` = 37 229 |
| Скасування того продажу | 14 | 173 735 | 124,0964 | повертаємо рівно 37 229 |
| Продаж решти 11 шт. (без скасування) | 0 | 0 | | `round(136506×11/11)` = 136 506 |

Сторно закупівлі після продажів не перераховує собівартість уже проданого (П7).

## 6. Фінансова модель

### 6.1 Каси

Дві каси довідника `cash-accounts` (`cash`, `bank`), розширюване. Залишок = `balanceBani` (кеш) = Σ `cash-moves.deltaBani`. Нестача в касі заборонена (`allowNegative = false`), перевірка тим самим умовним `$inc`.

### 6.2 Операції

| type | Обов'язкові зв'язки | cash-moves | Інші ефекти | Валідація |
|---|---|---|---|---|
| customer_receipt | customer або order | `account +amount` | клієнт: аванс `+amount`, далі розподіл по боргах (6.4); гостьове замовлення: `order.paidBani += amount`, `paymentState` | вказане замовлення не скасоване; проведене (`stockPostedAt`) або має опційний борг; гостьове: `amount ≤ total×100 − paidBani` |
| customer_refund | customer або order | `account −amount` | з order: `order.paidBani −= amount`; без order: аванс `−amount` (6.4) | з order: `amount ≤ paidBani`; без order: `amount ≤` аванс |
| supplier_payment | supplier | `account −amount` | зменшує борг постачальнику | переплата дозволена (аванс) |
| expense | category (+manager для isSalary) | `account −amount` | витрата періоду | |
| transfer | toAccount ≠ account | `account −amount`, `toAccount +amount` | | |

Статус `paid` у замовленні автоматично не ставимо: оплата живе в `paidBani`/`paymentState` (поля додані). Ручний `status` як і раніше (В6).

### 6.3 Борги

| Борг | Формула |
|---|---|
| Покупця по замовленню | `revenueBani − paidBani` для не скасованих проведених + опційні `customerDebt` − надходження по них |
| Баланс покупця | Σ боргів по його замовленнях − аванс (`customer-balances`, 6.4); мінус = ми винні клієнту |
| Постачальнику | Σ проведених `purchases.lines.amountBani` (supplier) + Σ `extraCosts.amountBani` (payee) + `supplierDebt` − Σ `supplier_payment` − сторновані |
| Менеджеру | Σ `payrolls.totalBani` (posted) − Σ витрат isSalary з цим `manager` |

ПДВ: поза обсягом. Усі суми як є (брутто). Якщо компанія платник ПДВ, вхідний ПДВ потрапляє в собівартість, що спотворює прибуток (В2).

### 6.4 Баланс клієнта (В14)

Гроші клієнта не прив'язані до замовлення: оптовий клієнт платить загальною сумою за кредитні
замовлення. Оплата кожного замовлення лишається в `orders.paidBani`/`paymentState` (на них стоять
зарплата, звіти й статуси), а не розподілені гроші лежать в авансі клієнта.

- `customer-balances`: один документ на клієнта, `balanceBani` = аванс (≥ 0), кеш журналу.
- `customer-moves`: журнал, лише доповнюється. Рядок: `customer`, `kind`, `advanceDeltaBani`,
  `order`, `orderDeltaBani`, документ-причина. Σ `advanceDeltaBani` клієнта = аванс,
  Σ `orderDeltaBani` замовлення = `paidBani` (перевіряє `cashCacheCheck`).
- Сервіс `customerBalance.service`: аванс змінюється умовним `$inc` у транзакції, `paidBani` через
  `changeOrderPaid`.

| Подія | Ефект |
|---|---|
| Надходження клієнта, початковий аванс, сторно повернення | аванс `+amount`, далі розподіл (`allocation`) |
| Розподіл | аванс гасить борги: спершу вказане замовлення, далі від найстарішого (`createdAt`) |
| Нове проведене замовлення клієнта | розподіл наявного авансу |
| Проведений `customerDebt` | розподіл авансу клієнтів цих замовлень |
| Повернення без замовлення | аванс `−amount`, не більше за аванс |
| Повернення по замовленню | `order.paidBani −= amount`, аванс не змінюється |
| Сторно надходження чи початкового авансу | спершу з авансу, решта знімається з оплат найновіших замовлень; якщо гроші вже повернули, помилка |
| Скасування замовлення клієнта, сторно `customerDebt` | `paidBani` замовлення повертається на аванс (`release`), далі розподіл по інших боргах |

Гостьові замовлення (без клієнта) аванса не мають: оплата прямо в замовлення, переплата заборонена,
оплачене замовлення не скасовується до повернення коштів.

Зарплата за `payment_date` бере найпізнішу дату рядка журналу з `orderDeltaBani > 0`, тобто момент,
коли замовлення отримало гроші (надходження або зарахування авансу).

## 7. Менеджери й зарплата

### 7.1 Знімок менеджера в замовленні (питання G)

Хук `beforeChange` Orders, лише `operation = create`:
```
customer = data.customer ? findByID(users, req) : null
if customer?.manager:                    manager = customer.manager       // продаж менеджера клієнта
elif creator має роль manager and settings.assignOrderToCreatorIfNoManager:
                                         manager = creator
else:                                    manager = null
createdBy = req.user?.id ?? null; source = (виклик із createOrder) ? 'web' : 'admin'
```

| Сценарій | manager у замовленні |
|---|---|
| Гість на сайті | null (до гостя прив'язки немає) |
| Клієнт сайту з менеджером | менеджер клієнта |
| Менеджер M2 створює замовлення клієнту менеджера M1 | **M1** (продаж належить менеджеру клієнта; `createdBy = M2` зберігається) |
| Менеджер створює замовлення клієнту без менеджера / без клієнта (магазин) | творець, якщо прапорець увімкнено; інакше null |
| Пізніше клієнта передали іншому менеджеру | історичні замовлення не змінюються (знімок) |

`source` визначається явно: `createOrder` передає `context: { orderSource: 'web' }` у `payload.create`; усе інше `admin`.

### 7.2 Розрахунок зарплати

```
payroll(manager, from, to): scheme = активна схема менеджера на to, інакше за замовчуванням
orders = orders where stockPostedAt != null and status != cancelled
         and attribution(snapshot: order.manager = M | current: customer.manager = M)
         and dateBasis(order_date: stockPostedAt ∈ [from,to] | payment_date: paymentState=paid і остання оплата ∈ [from,to])
         and customerFilter
for o in orders:
  base = revenue: o.revenueBani | gross_profit: o.revenueBani − o.cogsBani | paid_revenue: якщо paid, revenueBani
  line.amountBani = round(base × percent / 100)
total = fixedBani + Σ lines + adjustmentsBani
```

Виплата: `cash-operations` `expense` зі статтею `isSalary`, `manager`, `payroll`. Може бути кілька часткових виплат.
Замовлення, скасоване після затвердження payroll: автоматичної корекції немає, admin додає `adjustmentsBani` в наступний розрахунок (П9, ризик Р6).

## 8. Нумерація

Той самий механізм, що `setOrderNumber` (F7): колекція `counters`, `findOneAndUpdate $inc` поза транзакцією, пропуски допустимі.
Рефакторинг: винести загальний `nextCounterValue(req, key)` у `src/services/counters.ts`; `setOrderNumber` використовує його без зміни поведінки.

| Документ | Ключ counters | Формат |
|---|---|---|
| orders | `orderNumber` | як зараз (`"1029"`) |
| purchases | `purchaseNumber` | `PUR-000001` |
| stock-transfers | `transferNumber` | `TRF-000001` |
| stock-adjustments | `adjustmentNumber` | `ADJ-000001` |
| opening-balances | `openingNumber` | `OPN-000001` |
| cash-operations | `cashNumber` | `CSH-000001` |
| payrolls | `payrollNumber` | `PAY-000001` |

Номер видається при створенні чернетки. Без щорічного скидання (П10).

## 9. Інтеграція з Orders

### 9.1 Відповідь на A: Orders лишається документом продажу

Підтверджую. Окрема видаткова накладна не потрібна: немає часткових відвантажень, повернень і редагування після проведення (відповіді 1, 5), тож замовлення 1:1 = відвантаження. Продаж у «Магазині» = замовлення в адмінці зі складом «Магазин».

Момент списання: **при створенні** замовлення (відповідь 2 і D5 вимагають перевірки в транзакції створення; резервів без списання не робимо, бо це друга сутність із тим самим ефектом).

| Статус | Значення для обліку | Переходи |
|---|---|---|
| pending | товар списано, виручка й собівартість визнані | → paid, shipped, cancelled |
| paid | лише інформаційний (ручний) | → shipped, cancelled |
| shipped | інформаційний | → cancelled (admin; див. В5) |
| cancelled | кінцевий; рухи `sale_cancel` повертають кількість і рівно `cogsBani` | — |

Скасування (хук `afterChange`, `previousDoc.status ≠ cancelled`, `doc.status = cancelled`):
1. Якщо `stockPostedAt` порожнє (історичне замовлення або облік вимкнено) ⇒ лише статус.
2. Якщо `paidBani > 0` ⇒ помилка: спершу `customer_refund`.
3. Якщо `stockPostedAt ≤ lockedUntil` ⇒ помилка «період закрито».
4. Для кожної позиції: `qty += q` на складі замовлення, `product-costs: qty += q, valueBani += частка cogs` (зберігаємо `cogsBani` по позиціях у `stock-moves`, тож повертаємо точні значення); рух `sale_cancel`; `accounting.cancelledAt = now`.
Повернення з `cancelled` в інший статус заборонене (`beforeChange`).

### 9.2 Хуки й межі транзакції

| Хук | Порядок | Операція | Дія |
|---|---|---|---|
| beforeChange `setOrderNumber` | 1 | create | без змін |
| beforeChange `guardPostedOrder` (новий) | 2 | update | заборона змінювати `items`, `total`, `discount`, `customer`, `warehouse`, `manager`; заборона виходу з `cancelled` |
| beforeChange `populatePricesAndTotal` | 3 | **лише create** (зміна, див. F6) | без інших змін логіки |
| beforeChange `assignAccountingFields` (новий) | 4 | create | `warehouse`, `source`, `manager`, `createdBy`, `revenueBani` |
| beforeChange `deductOrderStock` (новий) | 5 | create, якщо `stockControlEnabled` | розд. 4.2: умовне списання кешу, розрахунок собівартості; кладе в `data` `stockPostedAt`, `cogsBani` і в `req.context` собівартість по позиціях. Повторного `update` замовлення немає, тож хук сповіщень не спрацьовує вдруге |
| afterChange `writeOrderStockMoves` (новий) | 1 | create, якщо є `stockPostedAt` | створює `stock-moves` з `docId = doc.id` з `req.context` |
| afterChange `cancelOrderStock` (новий) | 2 | update → cancelled | розд. 9.1 |
| afterChange `sendNewOrderNotification` | останній | | без змін; після коміту |
| beforeDelete `forbidDeletePosted` (новий) | | | замовлення з `stockPostedAt` не видаляється, тільки скасовується |

Транзакція:
- `createOrder`: уже відкриває `initTransaction(req)` до `payload.create`; хуки вище працюють у ній. Додати: розпізнати `InsufficientStockError` ⇒ 409; повтор на транзієнтних помилках (до 3 разів).
- Адмінка/REST: Payload сам відкриває транзакцію в операції `create`/`update` і передає `req` у хуки.
- Сповіщення після коміту вже гарантовано (`afterCommit`).
- Помилка в `afterChange` відкочує всю транзакцію, включно із замовленням.

### 9.3 Замовлення, створене менеджером в адмінці

| Що змінюється | Як |
|---|---|
| Доступ | `orders.create`: admin, manager; `read`: див. матрицю |
| `shippingAddress` | `required` стає умовним: обов'язкова для `source = web` (`createOrder` і так перевіряє наявність). Для адмінки опційна (продаж у магазині) |
| Ціни | `populatePricesAndTotal` на create ставить ціни каталогу; поле `price` позиції для manager readOnly (field access), admin може змінити до збереження (В7) |
| Склад | поле `warehouse` видиме, за замовчуванням `defaultAdminWarehouse` |
| Нестача | та сама помилка, Payload показує її як помилку збереження |
| Сповіщення | як зараз (лист покупцю, якщо є email; Telegram) |

## 10. Початкове завантаження даних

Процедура (одноразово, у неробочий час):

| Крок | Хто | Що |
|---|---|---|
| 0 | розробник | Розгорнуто код етапів 1-2 з `stockControlEnabled = false`. Замовлення створюються як зараз |
| 1 | admin | Довідники: склади (`main`, `shop`), каси (`cash`, `bank`), статті витрат, постачальники; `defaultWebWarehouse` |
| 2 | власник | Обирає дату відсічення T (кінець робочого дня). Після T до кроку 6 нові замовлення в адмінці не вводяться, сайт можна лишити: замовлення до вмикання не списують залишок і обліковуються як історичні |
| 3 | власник | Підрахунок залишків на T по кожному складу |
| 4 | admin | Імпорт CSV у чернетку `opening-balances` kind=stock скриптом `scripts/import-opening-stock.ts` (рядок: `article; warehouseCode; qty; unitCostMDL`). Скрипт лише створює чернетку й звіт помилок (невідомий артикул, дублі, qty ≤ 0, cost ≤ 0) |
| 5 | admin | Чернетки kind=cash (залишки кас на T), supplierDebt (борги постачальникам), за потреби customerDebt (неоплачені історичні замовлення) |
| 6 | admin | Перевірка, проведення всіх OPN, потім `stockControlEnabled = true` (`accountingStartAt = now`). Замовлення сайту, що надійшли між T і вмиканням, admin вводить як writeoff або коригує через inventory |

Дані від власника:
| Дані | Формат | Обов'язково |
|---|---|---|
| Залишок кожного товару по кожному складу | article, склад, к-сть | так |
| Початкова собівартість кожного товару з залишком | MDL за шт., 2 знаки | так; без неї середня не стартує. Якщо невідома: остання ціна закупівлі; запасний варіант `wholesalePrice × коефіцієнт`, узгоджений власником |
| Залишки кас | MDL на T | так |
| Борги постачальникам | постачальник, сума | так, якщо є |
| Неоплачені історичні замовлення | номер, сума боргу | ні |
| Менеджери й закріплені клієнти | email клієнта → менеджер | для етапу 4 |
| Схема зарплати | відсоток, база, оклад | для етапу 4 |

## 11. Матриця прав

| Ресурс | admin | manager | customer | гість |
|---|---|---|---|---|
| Адмін-панель (`Users.access.admin`) | так | так | ні | ні |
| products: read | так | так | опубліковані | опубліковані |
| products: update | так | так, крім заборонених полів | ні | ні |
| products: create/delete | так | ні (В8) | ні | ні |
| products.retailPrice, wholesalePrice: update | так | ні, лише read (В8) | — | — |
| products.wholesalePrice: read | так | так (продаж оптовикам) | оптовик | ні |
| Собівартість (`product-costs`, `accounting.*`, `stock-moves.value*`) | так | **ні** | ні | ні |
| orders: create | так | так (адмінка) | через `createOrder` | через `createOrder` |
| orders: read | усі | усі (обробка замовлень сайту; В9) | свої | ні |
| orders: update статусу | так | `pending → shipped` (В9) | ні | ні |
| orders: cancel | так | ні (В5) | ні | ні |
| orders: delete | лише непроведені | ні | ні | ні |
| orders.items.price при створенні | так | readOnly | — | — |
| users (клієнти): read | так | роль customer, без `roles` | себе | — |
| users: create клієнта | так | так, `manager` = він сам (В10) | реєстрація | реєстрація |
| users.manager, roles, wholesale, brandDiscounts: update | так | ні | ні | ні |
| warehouses, suppliers, cash-accounts, expense-categories | так | ні | ні | ні |
| stock-balances | так | read без вартості (В11, за замовч. ні) | ні | ні |
| purchases, transfers, adjustments, opening, cash-operations, payrolls, salary-schemes | так | ні | ні | ні |
| Звіти | усі | ні; зарплата: лише свої затверджені payroll (В12) | ні | ні |
| Проведення / сторно | так | ні | — | — |

Реалізація: хелпери `adminOrManager` (Access, boolean) і `adminOrManagerField` (FieldAccess); нові ендпоінти явно перевіряють роль (D7). Колекції з `access` лише через ці хелпери.

## 12. Мінімальні звіти

| Звіт | Засіб | Джерело |
|---|---|---|
| Залишки по складах | список `stock-balances` (фільтр склад, товар, `qty > 0`) + ендпоінт з вартістю для admin | кеш |
| Рух товару | список `stock-moves` (фільтри товар, склад, тип, дата) | журнал |
| Закупівлі й собівартість | список `purchases` + звіт: Σ goods/extra/landed за період, по постачальнику; `product-costs` зі середньою | документи |
| Залишки кас | список `cash-accounts` (колонка `balanceBani`) | кеш |
| Витрати за період | звіт: Σ `expense` по статтях за [from, to] | cash-operations |
| Прибуток | звіт, формула нижче | orders, stock-moves, cash-operations |
| Зарплата менеджерів | список `payrolls` + борг менеджеру | payrolls |
| Борги | звіт: покупці, постачальники, менеджери (6.3) | |

```
Прибуток[from,to] = Виручка − Собівартість − Втрати складу − Витрати
Виручка       = Σ revenueBani  замовлень зі stockPostedAt ∈ період, status ≠ cancelled
Собівартість  = Σ cogsBani     тих самих замовлень
Втрати складу = Σ −valueDelta  рухів writeoff/inventory у періоді (надлишки зменшують втрати)
Витрати       = Σ expense      операцій у періоді (касовий метод, зокрема зарплата)
```

Числовий приклад: виручка 50 000,00; собівартість 31 200,00; списання тестерів 450,00; оренда 6 000,00 + хостинг 300,00 + зарплата 4 000,00 ⇒ прибуток 50 000 − 31 200 − 450 − 10 300 = **8 050,00 MDL**.

Звіти з сумами: ендпоінти `GET /api/reports/{stock,purchases,expenses,profit,debts,salary}?from&to` (admin; агрегації MongoDB) + **один** кастомний view `/admin/reports` із фільтром періоду й таблицями.

## 13. Відповідь на H: стандартні засоби vs кастомні views

| Функція | Засіб Payload | Складність |
|---|---|---|
| Довідники, документи з рядками, статуси, фільтри списків | колекції, `array`, `select`, list view | S |
| Проведення / сторно | зміна `status` + хуки; кнопки не потрібні | M (логіка), S (UI) |
| Захист проведених | `beforeChange`/`beforeDelete`, field `admin.readOnly` за умовою | S |
| Ввід грошей у MDL зі зберіганням у банях | кастомний Field/Cell `MoneyField` (як `PriceField`) | S |
| Розподіл логістики, підсумки накладної | `beforeChange` рахує RO-поля; видно після збереження чернетки | S |
| Права за ролями й поля | `access`, field access | S |
| Залишок товару в картці товару (для admin/manager) | `ui`-поле з невеликим компонентом, що читає ендпоінт | S |
| Звіти з сумами й періодами | **кастомний view** `/admin/reports` | M-L |
| Імпорт початкових залишків | скрипт (не view) | M |
| Інвентаризація повного складу | кнопка «заповнити рядки» — необов'язкова, можна скриптом | S |

Кастомний view потрібен лише для звітів: список Payload не вміє сум і групувань.

## 14. Ризики

| # | Ризик | Вплив | Захід |
|---|---|---|---|
| Р1 | Прод ще standalone (D6) | без транзакцій умовне списання не відкочується разом із замовленням | розгортання не раніше переходу на replica set; при старті перевіряти `hello().setName` і не вмикати `stockControlEnabled` без нього |
| Р2 | `populatePricesAndTotal` на update (F6) | виручка й база зарплати змінюються після проведення | обмежити хук `create` + `guardPostedOrder` (задача S2.1), до вмикання обліку |
| Р3 | WriteConflict під навантаженням | помилки створення замовлень | повтор до 3 разів, сортування рядків |
| Р4 | Розходження кешу й журналу після ручних правок у БД | хибні залишки | `rebuild-stock-cache --check`; заборона прямих правок |
| Р5 | Сторно закупівлі після продажів | неточна собівартість минулих продажів | П7; блок при `value < 0` |
| Р6 | Скасування після затвердження зарплати | переплата менеджеру | ручна корекція `adjustmentsBani`; звіт «скасовані після payroll» |
| Р7 | Партії й строки придатності відкладено | для косметики важливі; додати пізніше = **переробка**: новий вимір у `stock-balances`/`stock-moves`, інша собівартість (за партіями) | якщо строки потрібні в найближчий рік, краще закласти поле `lot` зараз (В3) |
| Р8 | Варіанти товарів | якщо їх почнуть використовувати, ключ залишку зміниться | поле `variant` уже в ключі кешу й журналу (порожнє) |
| Р9 | Повернення від покупців відкладено | не потребує переробки: те саме, що скасування позиції (`sale_cancel` з кількістю) + `customer_refund` | — |
| Р10 | Мультивалютні закупівлі | постачальник в EUR | вводити суму в MDL за курсом оплати; поле `note` про валюту. Без переробки |
| Р11 | Нова відповідь 409 у `createOrder` | фронтенд показує загальну помилку | узгодити текст і код з фронтендом до вмикання |

## 15. Припущення

| # | Припущення |
|---|---|
| П1 | Собівартість середньозважена, одна на товар; партії й строки придатності не ведуться (власник окремо не відповідав) |
| П2 | Облік штучний, кількість ціла; ваговий/розливний товар не продається |
| П3 | Облікова одиниця = товар; варіанти плагіна не використовуються (F3) |
| П4 | ПДВ поза обсягом, суми брутто |
| П5 | Виручка = `orders.total` (вже з урахуванням знижок промокоду); доставка в замовленні не тарифікується |
| П6 | Документи проводяться датою проведення, заднім числом не можна; `documentDate` довідкова |
| П7 | Сторно закупівлі не перераховує собівартість уже проданого |
| П8 | Прибуток: виручка й собівартість за датою замовлення, витрати касовим методом |
| П9 | Затверджений payroll не змінюється; корекції наступним розрахунком |
| П10 | Номери документів без річного скидання, пропуски допустимі |
| П11 | Історичні замовлення (до `accountingStartAt`) не мають `stockPostedAt`, не списують і не повертають залишок; у звітах прибутку не враховуються |
| П12 | Надходження прив'язується до одного замовлення; оплата кількох замовлень = кілька операцій |
| П13 | Курс і комісії банку при переказах обліковуються як `expense` зі статтею «банківські комісії» |

## 16. Питання власнику (з рекомендацією)

| # | Питання | Рекомендація |
|---|---|---|
| В1 | Підтвердити один склад для всіх замовлень сайту | «Основний» як `defaultWebWarehouse` |
| В2 | Компанія платник ПДВ? | не є платник ПДВ |
| В3 | Чи потрібні строки придатності в межах року? | не потрібні |
| В4 | Показувати фронтенду наявність? Авто-`unavailable`? | додати лише `inStock: boolean`; `unavailable` лишити ручним |
| В5 | Хто скасовує замовлення й сторнує документи; чи можна скасувати `shipped` | лише admin; `shipped` скасовувати можна (повернення товару на склад до нового рішення про повернення) |
| В6 | Ставити `status = paid` автоматично при повній оплаті? | ні; `paymentState` окремо, щоб не ламати ручний процес і фронтенд |
| В7 | Чи може manager змінювати ціну/знижку в замовленні в адмінці? | ні; лише admin |
| В8 | Manager редагує ціни товарів і створює нові товари? | редагує описові поля, ціни лише бачить; створення й видалення в admin |
| В9 | Manager бачить усі замовлення і змінює статуси? | бачить усі; може `pending → shipped`, не скасовує |
| В10 | Manager створює клієнтів? | так, з автопризначенням себе менеджером |
| В11 | Manager бачить залишки по складах? | так, кількість без вартості (потрібно продавцю в магазині) |
| В12 | Manager бачить свою зарплату? | так, лише свої затверджені розрахунки |
| В13 | Схема зарплати за замовчуванням | `percent` від `revenue`, `dateBasis = order_date`, `attribution = snapshot`, місяць |
| В14 | Чий продаж, коли M2 оформлює клієнта M1 | M1 (менеджер клієнта); `assignOrderToCreatorIfNoManager = true` для клієнтів без менеджера |
| В15 | Негативний залишок каси | заборонити для обох кас |
| В16 | Початкова собівартість, якщо невідома | остання закупівельна ціна; інакше `wholesalePrice × k` з узгодженим k |
| В17 | Замовлення сайту між відсіченням і вмиканням обліку | вмикати в неробочий час одразу після підрахунку; рештку вирівняти інвентаризацією |
