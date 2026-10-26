import type { Who } from './accessAuditHttp'

/**
 * Таблиці очікувань аудиту доступу (R3). Єдине місце, де записано, ХТО й ЩО має право робити.
 * Тести повноти падають, якщо в конфігу з'явилась колекція, ендпоінт чи виклик Local API,
 * якого тут немає: новий ресурс не може потрапити в реліз без рішення про права.
 */

// ---------------------------------------------------------------------------
// A + B. Ресурси: колекції й глобали
// ---------------------------------------------------------------------------

/**
 * Хто має право на операцію. Літери: A = admin, M = manager, C = customer, G = гість.
 * Велика літера: доступ дозволено, перевіряється запитом до неіснуючого id (дозвіл = не 403/401).
 * Мала літера (c, m): доступ лише до своїх документів: на неіснуючий id відповідь 403/404 однакова,
 * тому це перевіряють окремі тести на реальних документах (B2), а матриця лише пропускає цю клітинку.
 */
export type Policy = string

export type ResourceRule = {
  create: Policy
  read: Policy
  update: Policy
  delete: Policy
  /** Додаток до шляху update (manager зберігає товар лише як чернетку). */
  updateQuery?: string
  why: string
}

const ONLY_ADMIN = (why: string): ResourceRule => ({ create: 'A', read: 'A', update: 'A', delete: 'A', why })
const CODE_ONLY = (read: Policy, why: string): ResourceRule => ({ create: '', read, update: '', delete: '', why })
const CONTENT = (why: string): ResourceRule => ({ create: 'AM', read: 'AMCG', update: 'AM', delete: 'AM', why })

export const RESOURCES: Record<string, ResourceRule> = {
  users: {
    create: 'AMCG',
    read: 'AMC',
    update: 'Amc',
    delete: 'A',
    why: 'розд. 11: реєстрація публічна, manager створює клієнтів; читання й зміна лише себе (manager читає ще й клієнтів); видаляє admin',
  },
  pages: CONTENT('контент сайту: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager'),
  posts: CONTENT('контент сайту: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager'),
  categories: CONTENT('каталог: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager'),
  brands: CONTENT('каталог: читають усі; запис admin і manager (адмінка); питання власнику Q2 щодо manager'),
  media: CONTENT('файли: читають усі; завантаження admin і manager (адмінка); питання власнику Q2 щодо manager'),
  'promo-codes': ONLY_ADMIN('промокоди бачить лише admin; клієнт перевіряє код через /api/carts/promo'),
  warehouses: { create: 'A', read: 'AM', update: 'A', delete: 'A', why: 'M1: manager читає склади (вибір складу в замовленні), запис admin' },
  suppliers: ONLY_ADMIN('розд. 11: довідник лише admin'),
  'stock-moves': CODE_ONLY('A', 'журнал пише лише код; читає admin (містить вартість)'),
  'stock-balances': CODE_ONLY('AM', 'кеш пише лише код; manager бачить кількість (В11)'),
  'product-costs': CODE_ONLY('A', 'кеш пише лише код; собівартість лише admin'),
  purchases: ONLY_ADMIN('розд. 11'),
  'stock-transfers': ONLY_ADMIN('розд. 11'),
  'stock-adjustments': ONLY_ADMIN('розд. 11'),
  'opening-balances': ONLY_ADMIN('розд. 11'),
  'cash-accounts': ONLY_ADMIN('розд. 11'),
  'expense-categories': ONLY_ADMIN('розд. 11'),
  'cash-moves': CODE_ONLY('A', 'журнал пише лише код'),
  'cash-operations': ONLY_ADMIN('розд. 11'),
  'salary-schemes': ONLY_ADMIN('розд. 11, В12: схеми менеджеру недоступні'),
  payrolls: { create: 'A', read: 'AM', update: 'A', delete: 'A', why: 'В12: manager читає лише свої проведені розрахунки (B2), решту admin' },
  addresses: {
    create: 'AMC',
    read: 'AMC',
    update: 'Amc',
    delete: 'Amc',
    why: 'плагін ecommerce: адреси своїх клієнтів (adminOrCustomerOwner)',
  },
  variants: { create: 'A', read: 'AMCG', update: 'A', delete: 'A', why: 'плагін ecommerce: варіанти не використовуються (П3), читання як у товарів' },
  variantTypes: { create: 'A', read: 'AMCG', update: 'A', delete: 'A', why: 'плагін ecommerce' },
  variantOptions: { create: 'A', read: 'AMCG', update: 'A', delete: 'A', why: 'плагін ecommerce' },
  products: {
    create: 'A',
    read: 'AMCG',
    update: 'AM',
    delete: 'A',
    updateQuery: '?draft=true',
    why: 'розд. 11, В8: manager редагує описові поля й зберігає чернетку; create/delete лише admin',
  },
  carts: {
    create: 'AMC',
    read: 'AMC',
    update: 'Amc',
    delete: 'Amc',
    why: 'кошик належить авторизованому користувачеві (гостьовий кошик живе в браузері: /api/carts/guest)',
  },
  orders: {
    create: 'AM',
    read: 'AMC',
    update: 'AM',
    delete: 'A',
    why: 'розд. 11: клієнт створює лише через /api/orders/create; читає свої (B2); update manager обмежує guardManagerOrderUpdate',
  },
  transactions: ONLY_ADMIN('плагін ecommerce: онлайн-платежів немає (D1)'),
  'payload-kv': CODE_ONLY('', 'системна: сховище ключ-значення Payload, доступ нікому'),
  'payload-locked-documents': {
    create: 'AMC',
    read: 'AMC',
    update: 'AMC',
    delete: 'AMC',
    why: 'системна: блокування документів в адмінці; керує сам Payload (див. DEFAULT_ACCESS_ALLOWLIST)',
  },
  'payload-preferences': {
    create: 'AMC',
    read: 'AMC',
    update: 'AMC',
    delete: 'AMC',
    why: 'системна: налаштування інтерфейсу користувача; доступ лише до своїх записів (preferenceAccess)',
  },
  'payload-migrations': CODE_ONLY('', 'системна: REST вимкнено (501), graphQL вимкнено'),
}

export const GLOBALS: Record<string, { read: Policy; update: Policy; why: string }> = {
  'accounting-settings': { read: 'A', update: 'A', why: 'M1: налаштування обліку лише admin' },
}

/**
 * Відхилення від очікуваного (знахідки): ключ `колекція.операція.роль`. Основна матриця ці клітинки
 * пропускає, а правильну поведінку фіксує тест у блоці `[FINDING-n]` (test.failing).
 */
export const KNOWN_DEVIATIONS: Record<string, number> = {
}

/**
 * Ресурси, де дефолтний access Payload (`Boolean(user)`, тобто «будь-який авторизований, зокрема customer»)
 * є свідомим рішенням. Ключ `slug.операція`; значення: причина.
 */
export const DEFAULT_ACCESS_ALLOWLIST: Record<string, string> = {
  'payload-locked-documents.create': 'системна колекція Payload (блокування документів в адмінці), hidden, керується ядром',
  'payload-locked-documents.read': 'системна колекція Payload (блокування документів в адмінці), hidden, керується ядром',
  'payload-locked-documents.update': 'системна колекція Payload (блокування документів в адмінці), hidden, керується ядром',
  'payload-locked-documents.delete': 'системна колекція Payload (блокування документів в адмінці), hidden, керується ядром',
  'addresses.create': 'плагін ecommerce: клієнт створює власну адресу; читання й зміну обмежує adminOrCustomerOwner',
  'payload-preferences.create': 'системна колекція Payload: ядро саме прив’язує запис до користувача',
  'payload-preferences.update': 'системна колекція Payload: ядро саме прив’язує запис до користувача',
  'payload-migrations.create': 'системна колекція Payload: REST і graphQL вимкнено ядром (відповідь 501)',
  'payload-migrations.read': 'системна колекція Payload: REST і graphQL вимкнено ядром (відповідь 501)',
  'payload-migrations.update': 'системна колекція Payload: REST і graphQL вимкнено ядром (відповідь 501)',
  'payload-migrations.delete': 'системна колекція Payload: REST і graphQL вимкнено ядром (відповідь 501)',
}

/** Відомі випадки дефолтного access, які є знахідками (не винятки): ключ `slug.операція` -> номер знахідки. */
export const DEFAULT_ACCESS_FINDINGS: Record<string, number> = {
}

// ---------------------------------------------------------------------------
// D. Ендпоінти
// ---------------------------------------------------------------------------

export type Fx = {
  productId: string
  draftProductId: string
  brandSlug: string
  categorySlug: string
  pageSlug: string
}

type Check = number | ((status: number) => boolean)

export type EndpointCase = {
  /** `МЕТОД url`, як в інвентаризації (`:param` лишається). */
  key: string
  access: 'public' | 'auth' | 'optional-auth' | 'admin' | 'staff' | 'core'
  why: string
  request: (fx: Fx) => { method: string; path: string; body?: unknown }
  expect: Record<Who, Check>
  /** Ролі, яких не викликаємо: запит змінює спільні дані. Причина обов'язкова. */
  skip?: Partial<Record<Who, string>>
  /** Запит із навмисно хибними параметрами: відповідь для відмовлених ролей має лишитись 401/403 (роль першою). */
  garbage?: { method: string; path: string; body?: unknown }
  /** Відомі порушення «роль першою»: роль -> номер знахідки. */
  roleFirstFinding?: Partial<Record<Who, number>>
  /** Відоме відхилення статусу (знахідка): приймається в основній таблиці, правильну поведінку фіксує [FINDING-n]. */
  knownDeviation?: { finding: number; status: number }
}

const ok = (status: number) => status >= 200 && status < 300
const notAuthError = (status: number) => status !== 401 && status !== 403 && status < 500
const authedOk = (status: number) => status !== 401 && status < 500
const everyone = (check: Check): Record<Who, Check> => ({ guest: check, customer: check, manager: check, admin: check })
const authed = (check: Check): Record<Who, Check> => ({ guest: 401, customer: check, manager: check, admin: check })
const adminOnly = (check: Check = 200): Record<Who, Check> => ({ guest: 401, customer: 403, manager: 403, admin: check })

const REPORT_QUERY = '?from=2003-01-01&to=2003-01-31'
const REPORT_GARBAGE = '?from=abc&to=-1&limit=-5&page=x&supplier=%7B%22$ne%22:1%7D'

const report = (name: string): EndpointCase => ({
  key: `GET /reports/${name}`,
  access: 'admin',
  why: 'R1: звіт з сумами й собівартістю, лише admin; роль перевіряється першою (requireAdmin)',
  request: () => ({ method: 'GET', path: `/reports/${name}${REPORT_QUERY}` }),
  expect: adminOnly(200),
  garbage: { method: 'GET', path: `/reports/${name}${REPORT_GARBAGE}` },
})

export const ENDPOINTS: EndpointCase[] = [
  {
    key: 'GET /menu',
    access: 'public',
    why: 'меню сайту: категорії й бренди, публічні дані',
    request: () => ({ method: 'GET', path: '/menu' }),
    expect: everyone(200),
  },
  {
    key: 'GET /stock/cache-check',
    access: 'admin',
    why: 'службова перевірка кешу залишків, лише admin',
    request: () => ({ method: 'GET', path: '/stock/cache-check' }),
    expect: adminOnly(200),
    garbage: { method: 'GET', path: '/stock/cache-check?x=%00' },
  },
  {
    key: 'POST /stock/cache-rebuild',
    access: 'admin',
    why: 'службова перебудова кешу залишків, лише admin',
    request: () => ({ method: 'POST', path: '/stock/cache-rebuild', body: {} }),
    expect: adminOnly(200),
    skip: { admin: 'перебудовує спільний кеш; успішний шлях admin покрито в stockCacheCheck.int.spec.ts' },
    garbage: { method: 'POST', path: '/stock/cache-rebuild', body: { garbage: true } },
  },
  {
    key: 'GET /cash/cache-check',
    access: 'admin',
    why: 'службова перевірка кешу кас, лише admin',
    request: () => ({ method: 'GET', path: '/cash/cache-check' }),
    expect: adminOnly(200),
    garbage: { method: 'GET', path: '/cash/cache-check?x=%00' },
  },
  {
    key: 'POST /cash/cache-rebuild',
    access: 'admin',
    why: 'службова перебудова кешу кас, лише admin',
    request: () => ({ method: 'POST', path: '/cash/cache-rebuild', body: {} }),
    expect: adminOnly(200),
    skip: { admin: 'перебудовує спільний кеш; успішний шлях admin покрито в cashCacheCheck.int.spec.ts' },
    garbage: { method: 'POST', path: '/cash/cache-rebuild', body: { garbage: true } },
  },
  {
    key: 'GET /stock/product/:id',
    access: 'staff',
    why: 'В11: admin бачить залишки з вартістю, manager лише кількість; customer 403',
    request: (fx) => ({ method: 'GET', path: `/stock/product/${fx.productId}` }),
    expect: { guest: 401, customer: 403, manager: 200, admin: 200 },
    garbage: { method: 'GET', path: '/stock/product/not-an-id' },
  },
  report('stock'),
  report('purchases'),
  report('expenses'),
  report('profit'),
  report('debts'),
  report('salary'),
  {
    key: 'POST /users/favorites',
    access: 'auth',
    why: 'обране поточного користувача',
    request: (fx) => ({ method: 'POST', path: '/users/favorites', body: { id: fx.productId } }),
    expect: { guest: 401, customer: ok, manager: ok, admin: ok },
  },
  {
    key: 'GET /users/favorites/my',
    access: 'optional-auth',
    why: 'гість отримує порожній список (200), авторизований свої id',
    request: () => ({ method: 'GET', path: '/users/favorites/my' }),
    expect: everyone(200),
  },
  {
    key: 'GET /users/favorites',
    access: 'optional-auth',
    why: 'гість отримує порожній список (200), авторизований свої товари',
    request: () => ({ method: 'GET', path: '/users/favorites' }),
    expect: everyone(200),
  },
  {
    key: 'DELETE /users/favorites/:id',
    access: 'auth',
    why: 'обране поточного користувача',
    request: (fx) => ({ method: 'DELETE', path: `/users/favorites/${fx.productId}` }),
    expect: { guest: 401, customer: ok, manager: ok, admin: ok },
  },
  {
    key: 'PATCH /users/update',
    access: 'auth',
    why: 'власні контактні дані; білий список name, surname, phone, city, street',
    request: () => ({ method: 'PATCH', path: '/users/update', body: { city: 'Chisinau' } }),
    expect: { guest: 401, customer: 200, manager: 200, admin: 200 },
  },
  {
    key: 'GET /pages/:slug',
    access: 'public',
    why: 'публічна сторінка сайту',
    request: (fx) => ({ method: 'GET', path: `/pages/${fx.pageSlug}` }),
    expect: everyone(200),
  },
  {
    key: 'GET /posts',
    access: 'public',
    why: 'публічний список постів',
    request: () => ({ method: 'GET', path: '/posts?limit=1' }),
    expect: everyone(200),
  },
  {
    key: 'GET /posts/:slug',
    access: 'public',
    why: 'публічний пост',
    request: () => ({ method: 'GET', path: '/posts/no-such-post-r3' }),
    expect: everyone(404),
  },
  {
    key: 'GET /brands/:slug',
    access: 'public',
    why: 'публічна картка бренду',
    request: (fx) => ({ method: 'GET', path: `/brands/${fx.brandSlug}` }),
    expect: everyone(200),
  },
  {
    key: 'GET /products/products-category/:slug',
    access: 'public',
    why: 'публічний каталог',
    request: (fx) => ({ method: 'GET', path: `/products/products-category/${fx.categorySlug}` }),
    expect: everyone(200),
  },
  {
    key: 'GET /products/products-brand/:slug',
    access: 'public',
    why: 'публічний каталог',
    request: (fx) => ({ method: 'GET', path: `/products/products-brand/${fx.brandSlug}` }),
    expect: everyone(200),
  },
  {
    key: 'GET /products/products-search',
    access: 'public',
    why: 'публічний пошук',
    request: () => ({ method: 'GET', path: '/products/products-search?q=zz' }),
    expect: everyone(200),
  },
  {
    key: 'GET /products/bestsellers',
    access: 'public',
    why: 'публічний каталог',
    request: () => ({ method: 'GET', path: '/products/bestsellers' }),
    expect: everyone(200),
  },
  {
    key: 'GET /products/:identifier',
    access: 'public',
    why: 'публічна картка товару (за id або slug); перекриває стандартний GET /products/:id',
    request: (fx) => ({ method: 'GET', path: `/products/${fx.productId}` }),
    expect: everyone(200),
  },
  {
    key: 'GET /carts/me',
    access: 'auth',
    why: 'кошик поточного користувача',
    request: () => ({ method: 'GET', path: '/carts/me' }),
    expect: authed(200),
  },
  {
    key: 'POST /carts/add-item',
    access: 'auth',
    why: 'кошик поточного користувача',
    request: (fx) => ({ method: 'POST', path: '/carts/add-item', body: { item: { productId: fx.productId, quantity: 1 } } }),
    expect: authed(ok),
    garbage: { method: 'POST', path: '/carts/add-item', body: {} },
  },
  {
    key: 'PATCH /carts/update-item',
    access: 'auth',
    why: 'кошик поточного користувача',
    request: (fx) => ({ method: 'PATCH', path: '/carts/update-item', body: { item: { productId: fx.productId, quantity: 2 } } }),
    expect: authed(authedOk),
    garbage: { method: 'PATCH', path: '/carts/update-item', body: {} },
  },
  {
    key: 'POST /carts/remove-item',
    access: 'auth',
    why: 'кошик поточного користувача; чужий cartId дає 403',
    request: (fx) => ({ method: 'POST', path: '/carts/remove-item', body: { cartId: 'ffffffffffffffffffffffff', productId: fx.productId } }),
    expect: authed((status) => status >= 400 && status < 500 && status !== 401),
    garbage: { method: 'POST', path: '/carts/remove-item', body: {} },
  },
  {
    key: 'POST /carts/clear',
    access: 'auth',
    why: 'кошик поточного користувача',
    request: () => ({ method: 'POST', path: '/carts/clear', body: {} }),
    expect: authed(200),
    garbage: { method: 'POST', path: '/carts/clear', body: { garbage: true } },
  },
  {
    key: 'POST /carts/guest',
    access: 'public',
    why: 'розрахунок гостьового кошика з браузера (D5): товари й кількості, даних інших клієнтів немає',
    request: (fx) => ({ method: 'POST', path: '/carts/guest', body: { items: [{ productId: fx.productId, quantity: 1 }] } }),
    expect: everyone(200),
  },
  {
    key: 'POST /carts/merge',
    access: 'auth',
    why: 'об’єднання гостьового кошика зі своїм',
    request: (fx) => ({ method: 'POST', path: '/carts/merge', body: { items: [{ product: { id: fx.productId }, quantity: 1 }] } }),
    expect: authed(ok),
    garbage: { method: 'POST', path: '/carts/merge', body: {} },
  },
  {
    key: 'POST /carts/promo',
    access: 'public',
    why: 'перевірка промокоду гостем і клієнтом; чужий cartId дає 403',
    request: () => ({ method: 'POST', path: '/carts/promo', body: { promoCode: 'NO-SUCH-PROMO-R3' } }),
    expect: everyone(400),
  },
  {
    key: 'POST /orders/create',
    access: 'public',
    why: 'D5: гостьові замовлення потрібні; ціни, склад, менеджер, джерело, статус задає сервер',
    request: (fx) => ({
      method: 'POST',
      path: '/orders/create',
      body: {
        items: [{ product: fx.productId, quantity: 1 }],
        shippingAddress: { name: 'Audit', phone: '+37360000000', email: 'audit@example.test', city: 'Chisinau', address: 'Str. 1' },
      },
    }),
    expect: everyone(201),
  },
  {
    key: 'GET /orders/my',
    access: 'auth',
    why: 'власні замовлення клієнта у вигляді нормалізованого списку',
    request: () => ({ method: 'GET', path: '/orders/my' }),
    expect: authed(200),
  },
  {
    key: 'POST /plugin-seo/generate-title',
    access: 'core',
    why: 'плагін seo: чиста функція над тілом запиту (generateTitle), даних із БД не читає; перевірки автентифікації в плагіні немає (FINDING-15)',
    request: () => ({ method: 'POST', path: '/plugin-seo/generate-title', body: { doc: { title: 'T' }, collectionSlug: 'products' } }),
    expect: everyone(200),
  },
  {
    key: 'POST /plugin-seo/generate-description',
    access: 'core',
    why: 'плагін seo: generateDescription не налаштовано, повертає порожній рядок (FINDING-15)',
    request: () => ({ method: 'POST', path: '/plugin-seo/generate-description', body: { doc: {}, collectionSlug: 'products' } }),
    expect: everyone(200),
  },
  {
    key: 'POST /plugin-seo/generate-url',
    access: 'core',
    why: 'плагін seo: чиста функція над тілом запиту (generateURL) (FINDING-15)',
    request: () => ({ method: 'POST', path: '/plugin-seo/generate-url', body: { doc: { slug: 's' }, collectionSlug: 'products' } }),
    expect: everyone(200),
  },
  {
    key: 'POST /plugin-seo/generate-image',
    access: 'core',
    why: 'плагін seo: generateImage не налаштовано, повертає порожній рядок (FINDING-15)',
    request: () => ({ method: 'POST', path: '/plugin-seo/generate-image', body: { doc: {}, collectionSlug: 'products' } }),
    expect: everyone(200),
  },
  {
    key: 'POST /reorder',
    access: 'core',
    why: 'ядро Payload (orderable у variantTypes): перед зміною виконує access.update колекції (adminOnly)',
    request: () => ({
      method: 'POST',
      path: '/reorder',
      body: { collectionSlug: 'variantTypes', docsToMove: [MISSING], newKeyWillBe: 'greater', orderableFieldName: '_order', target: { id: MISSING, key: 'a0' } },
    }),
    expect: { guest: 403, customer: 403, manager: 403, admin: notAuthError },
  },
]
const MISSING = 'ffffffffffffffffffffffff'

// ---------------------------------------------------------------------------
// E. Виклики Local API в ендпоінтах і сервісах
// ---------------------------------------------------------------------------

/**
 * Класифікація кожного виклику з `overrideAccess` за замовчуванням (тобто `true`):
 *  own       — вибірка/зміна лише за `req.user.id`, параметри не з тіла запиту;
 *  checked   — читає за id з тіла запиту, але власність перевіряється вручну до відповіді;
 *  public    — публічні дані, фільтр із коду або slug з URL;
 *  staff     — перед викликом ендпоінт перевіряє роль admin/manager;
 *  admin     — перед викликом ендпоінт перевіряє роль admin;
 *  service   — службовий виклик усередині хуків/сервісів, параметри лише з коду або з уже перевіреного документа;
 *  FINDING-n — ВРАЗЛИВИЙ: обхід access віддає або приймає більше, ніж дозволяє колекція.
 */
export type LocalApiClass = 'own' | 'checked' | 'public' | 'staff' | 'admin' | 'service' | `FINDING-${number}`

export const LOCAL_API_REVIEW: Record<string, LocalApiClass> = {
  'collections/Brands/endpoints/getBrandInfo.ts:find:brands#1': 'public',
  'collections/Carts/endpoints/addCartItem.ts:update:carts#1': 'own',
  'collections/Carts/endpoints/clearCart.ts:find:carts#1': 'own',
  'collections/Carts/endpoints/clearCart.ts:update:carts#1': 'own',
  'collections/Carts/endpoints/getCartByUser.ts:find:carts#1': 'own',
  'collections/Carts/endpoints/mergeCart.ts:update:carts#1': 'own',
  'collections/Carts/endpoints/removeCartItem.ts:findByID:carts#1': 'checked',
  'collections/Carts/endpoints/removeCartItem.ts:update:carts#1': 'own',
  'collections/Carts/endpoints/updateCartItem.ts:find:carts#1': 'own',
  'collections/Carts/endpoints/updateCartItem.ts:update:carts#1': 'own',
  'collections/Carts/endpoints/validatePromo.ts:findByID:carts#1': 'checked',
  'collections/Carts/services/checkPromoCode.ts:find:promo-codes#1': 'public',
  'collections/Carts/services/getOrCreateCart.ts:find:carts#1': 'own',
  'collections/Carts/services/getOrCreateCart.ts:create:carts#1': 'own',
  'collections/Carts/services/normalizedCart.ts:find:products#1': 'public',
  'collections/Orders/endpoints/createOrder.ts:findByID:products#1': 'public',
  'collections/Orders/endpoints/createOrder.ts:create:orders#1': 'service',
  'collections/Orders/endpoints/createOrder.ts:findByID:orders#1': 'service',
  'collections/Orders/endpoints/getMyOrders.ts:find:orders#1': 'own',
  'collections/Orders/services/getNormalizedOrders.ts:findByID:products#1': 'own',
  'collections/Pages/endpoints/getPageBySlug.ts:find:pages#1': 'public',
  'collections/Posts/endpoints/getPosts.ts:find:posts#1': 'public',
  'collections/Posts/endpoints/getSinglePost.ts:find:posts#1': 'public',
  'collections/Products/endpoints/getBestSellers.ts:find:products#1': 'public',
  'collections/Products/endpoints/getSingleProduct.ts:find:products#1': 'public',
  'collections/Products/endpoints/searchProducts.ts:find:brands#1': 'public',
  'collections/Products/endpoints/searchProducts.ts:find:products#1': 'public',
  'collections/Products/services/productsByRelation.service.ts:findGlobal:accounting-settings#1': 'service',
  'collections/Products/services/productsByRelation.service.ts:find:stock-balances#1': 'service',
  'collections/Products/services/productsByRelation.service.ts:find:(змінна)#1': 'public',
  'collections/Products/services/productsByRelation.service.ts:find:products#1': 'public',
  'collections/Users/endpoints/addFavoritesItem.ts:update:users#1': 'own',
  'collections/Users/endpoints/getFavorites.ts:findByID:users#1': 'own',
  'collections/Users/endpoints/getFavorites.ts:find:products#1': 'public',
  'collections/Users/endpoints/getMyFavorites.ts:findByID:users#1': 'own',
  'collections/Users/endpoints/removeFavoritesItem.ts:update:users#1': 'own',
  'collections/Users/services/getPricingProfile.ts:find:users#1': 'own',
  'endpoints/cashCacheCheck.ts:update:cash-accounts#1': 'admin',
  'endpoints/getMenu.ts:find:categories#1': 'public',
  'endpoints/getMenu.ts:find:brands#1': 'public',
  'endpoints/getProductStock.ts:findByID:products#1': 'staff',
  'endpoints/getProductStock.ts:find:stock-balances#1': 'staff',
  'endpoints/getProductStock.ts:find:product-costs#1': 'staff',
  'endpoints/stockCacheCheck.ts:find:stock-balances#1': 'admin',
  'endpoints/stockCacheCheck.ts:find:product-costs#1': 'admin',
  'endpoints/stockCacheCheck.ts:find:stock-balances#2': 'admin',
  'endpoints/stockCacheCheck.ts:update:stock-balances#1': 'admin',
  'endpoints/stockCacheCheck.ts:create:stock-balances#1': 'admin',
  'endpoints/stockCacheCheck.ts:find:product-costs#2': 'admin',
  'endpoints/stockCacheCheck.ts:update:product-costs#1': 'admin',
  'endpoints/stockCacheCheck.ts:create:product-costs#1': 'admin',
  'services/documents/documentLifecycle.ts:findGlobal:accounting-settings#1': 'service',
  'services/documents/documentLifecycle.ts:count:(змінна)#1': 'service',
  'services/documents/documentLifecycle.ts:findByID:(змінна)#1': 'service',
  'services/reports/common.ts:findGlobal:accounting-settings#1': 'admin',
}
