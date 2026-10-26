// @vitest-environment node
// Аудит доступу перед релізом (R3): docs/accounting/access-audit.md.
// Запити йдуть через REST (handleEndpoints) з токенами admin / manager / customer і без токена, як у
// accessMatrix.int.spec.ts. Тести з префіксом [FINDING-n] описують ПРАВИЛЬНУ поведінку й позначені
// it.fails: поки знахідка не виправлена, вони «падають» (тобто проходять як очікувана невдача).
// Після виправлення it.fails починає червоніти: тоді замініть it.fails на it (див. звіт, розд. «Як вмикати»).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  endpointClosure,
  inventoryEndpoints,
  inventoryEntities,
  inventoryFields,
  scanLocalApi,
} from './helpers/accessAudit'
import {
  allowedStatus,
  deepKeys,
  idOf,
  MISSING_ID,
  PASSWORD,
  setupAudit,
  WHO,
  type AuditContext,
  type Who,
} from './helpers/accessAuditHttp'
import {
  DEFAULT_ACCESS_ALLOWLIST,
  DEFAULT_ACCESS_FINDINGS,
  ENDPOINTS,
  GLOBALS,
  KNOWN_DEVIATIONS,
  LOCAL_API_REVIEW,
  RESOURCES,
  type Fx,
} from './helpers/accessAuditTables'
import { cleanupStock, deleteDocumentsDirectly, stockUp, type AuthUser } from './helpers/stock'

let ctx: AuditContext
let fx: Fx

const tag = `r3-${Date.now()}`
const orderIds: string[] = []
const productIds: string[] = []
const warehouseIds: string[] = []
const payrollIds: string[] = []
const cleanups: Array<() => Promise<unknown>> = []

const f = {
  brand: '',
  pub: '',
  pub2: '',
  draft: '',
  warehouse: '',
  orderOwn: '',
  orderOwnLow: '',
  orderOther: '',
  orderOfManager2: '',
  payrollOwnPosted: '',
  payrollOwnDraft: '',
  payrollOtherPosted: '',
}
let wholesaleCustomer: AuthUser

const LETTER: Record<Who, string> = { admin: 'A', manager: 'M', customer: 'C', guest: 'G' }

const objectId = (id: string) => new (ctx.payload.db.collections.orders.base.Types.ObjectId)(id)

/** Облікові поля замовлення напряму в БД: REST їх не дає задати, а вони потрібні для перевірок витоку. */
const setAccounting = (id: string, accounting: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ctx.payload.db.collections.orders.updateOne(
    { _id: id },
    { $set: { ...Object.fromEntries(Object.entries(accounting).map(([k, v]) => [`accounting.${k}`, v])), ...extra } },
  )

const insertPayroll = async (manager: string, status: 'draft' | 'posted') => {
  const model = ctx.payload.db.collections.payrolls
  const now = new Date()
  const { insertedId } = await model.collection.insertOne({
    number: `${tag}-${payrollIds.length}`,
    status,
    manager: objectId(manager),
    createdAt: now,
    updatedAt: now,
  })
  payrollIds.push(String(insertedId))
  return String(insertedId)
}

beforeAll(async () => {
  ctx = await setupAudit()
  const { payload, data, actors } = ctx

  wholesaleCustomer = await ctx.makeUser(['customer'], { wholesale: true })
  f.brand = String((await data.brand(`${tag} brand`)).id)

  const pub = await data.product({ brand: f.brand, retailPrice: 100, wholesalePrice: 80 })
  const pub2 = await data.product({ brand: f.brand, retailPrice: 200, wholesalePrice: 10 })
  f.pub = String(pub.id)
  f.pub2 = String(pub2.id)
  const draft = await payload.create({
    collection: 'products',
    data: {
      title: `${tag} DRAFT-SECRET`,
      slug: `${tag}-draft`,
      subtitle: 'Чернетка',
      article: `${tag}-D`,
      brand: f.brand,
      retailPrice: 55,
      wholesalePrice: 44,
      bestSeller: true,
      _status: 'draft',
    } as never,
    draft: true,
  })
  f.draft = String(draft.id)
  productIds.push(f.pub, f.pub2, f.draft)

  const warehouse = await payload.create({ collection: 'warehouses', data: { name: `${tag} склад`, code: tag } })
  f.warehouse = String(warehouse.id)
  warehouseIds.push(f.warehouse)

  const category = await payload.create({ collection: 'categories', data: { title: `${tag} cat`, slug: `${tag}-cat` } as never })
  const page = await payload.create({ collection: 'pages', data: { title: `${tag} page`, slug: `${tag}-page` } as never })
  const brandDoc = await payload.findByID({ collection: 'brands', id: f.brand, depth: 0 })
  fx = {
    productId: f.pub,
    draftProductId: f.draft,
    brandSlug: String(brandDoc.slug),
    categorySlug: String(category.slug),
    pageSlug: String(page.slug),
  }
  cleanups.push(
    () => payload.delete({ collection: 'categories', id: category.id }),
    () => payload.delete({ collection: 'pages', id: page.id }),
  )

  const newOrder = async (customer: string) => {
    const order = await payload.create({
      collection: 'orders',
      user: actors.admin,
      data: { items: [{ product: f.pub, quantity: 1, price: 0 }], total: 0, customer, warehouse: f.warehouse } as never,
      depth: 0,
    })
    orderIds.push(String(order.id))
    return String(order.id)
  }
  f.orderOwn = await newOrder(String(actors.customer.id))
  f.orderOwnLow = await newOrder(String(actors.customer.id))
  f.orderOther = await newOrder(String(actors.customer2.id))
  f.orderOfManager2 = await newOrder(String(actors.customer2.id))
  await setAccounting(f.orderOwn, { cogsBani: 777, revenueBani: 999 })
  await setAccounting(f.orderOwnLow, { cogsBani: 111, revenueBani: 999 })
  await setAccounting(f.orderOther, { cogsBani: 500, revenueBani: 900 })
  await setAccounting(f.orderOfManager2, { cogsBani: 300, revenueBani: 900 }, { manager: objectId(String(actors.manager2.id)) })

  f.payrollOwnPosted = await insertPayroll(String(actors.manager.id), 'posted')
  f.payrollOwnDraft = await insertPayroll(String(actors.manager.id), 'draft')
  f.payrollOtherPosted = await insertPayroll(String(actors.manager2.id), 'posted')
}, 120000)

afterAll(async () => {
  if (!ctx) return
  for (const cleanup of cleanups) await cleanup().catch(() => {})
  await ctx.payload.delete({ collection: 'products', id: f.draft }).catch(() => {})
  await deleteDocumentsDirectly(ctx.payload, 'orders', orderIds)
  await deleteDocumentsDirectly(ctx.payload, 'payrolls', payrollIds)
  await cleanupStock(ctx.payload, productIds, warehouseIds)
  await ctx.data.cleanup()
}, 120000)

// ---------------------------------------------------------------------------
// A. Явність access
// ---------------------------------------------------------------------------

describe('A. явність access: жодного дефолту без рішення', () => {
  it('жодна колекція чи глобал не покладається на дефолтний access без позначки у виняткових таблицях', () => {
    const offenders: string[] = []
    for (const entity of inventoryEntities(ctx.payload.config)) {
      for (const [op, rule] of Object.entries(entity.access)) {
        if (rule.kind === 'explicit') continue
        const key = `${entity.slug}.${op}`
        if (DEFAULT_ACCESS_ALLOWLIST[key] || DEFAULT_ACCESS_FINDINGS[key] !== undefined) continue
        offenders.push(`${key}: ${rule.text}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('кожен виняток обґрунтований, а список винятків не містить застарілих рядків', () => {
    const entities = new Map(inventoryEntities(ctx.payload.config).map((entity) => [entity.slug, entity]))
    for (const [key, reason] of Object.entries(DEFAULT_ACCESS_ALLOWLIST)) {
      expect(reason.length, key).toBeGreaterThan(20)
      const [slug, op] = key.split('.')
      expect(entities.get(slug)?.access[op]?.kind, `${key} уже не дефолтний: приберіть із allowlist`).not.toBe('explicit')
    }
  })

  it('знахідки з дефолтним access у таблиці досі актуальні (після виправлення рядок слід прибрати)', () => {
    const entities = new Map(inventoryEntities(ctx.payload.config).map((entity) => [entity.slug, entity]))
    for (const key of Object.keys(DEFAULT_ACCESS_FINDINGS)) {
      const [slug, op] = key.split('.')
      expect(entities.get(slug)?.access[op]?.kind, `${key} виправлено: приберіть із DEFAULT_ACCESS_FINDINGS`).not.toBe('explicit')
    }
  })

  it('кожна колекція й глобал конфігу є в таблицях очікувань і навпаки', () => {
    const { collections, globals } = ctx.payload.config
    expect(collections.map((c) => c.slug).sort()).toEqual(Object.keys(RESOURCES).sort())
    expect(globals.map((g) => g.slug).sort()).toEqual(Object.keys(GLOBALS).sort())
  })

  it('Users.access.admin пускає лише admin і manager (admin.hidden лише UX і як захист не рахується)', async () => {
    const access = ctx.payload.config.collections.find((c) => c.slug === 'users')!.access.admin!
    const can = async (who: Who) => access({ req: { user: ctx.userOf(who) } } as never)
    expect([await can('admin'), await can('manager'), await can('customer'), await can('guest')]).toEqual([true, true, false, false])
  })
})

// ---------------------------------------------------------------------------
// B. Матриця ресурсів через REST
// ---------------------------------------------------------------------------

describe('B. матриця ресурсів (REST): create / read / update / delete × гість, customer, manager, admin', () => {
  for (const [slug, rule] of Object.entries(RESOURCES)) {
    it(`${slug}: ${rule.why}`, async () => {
      const operations = [
        ['create', 'POST', `/${slug}`, {}],
        ['read', 'GET', `/${slug}?limit=1`, undefined],
        ['update', 'PATCH', `/${slug}/${MISSING_ID}${rule.updateQuery ?? ''}`, {}],
        ['delete', 'DELETE', `/${slug}/${MISSING_ID}`, undefined],
      ] as const

      const mismatches: string[] = []
      for (const [op, method, path, body] of operations) {
        for (const who of WHO) {
          const policy = rule[op]
          if (policy.includes(LETTER[who].toLowerCase())) continue // «лише своє»: перевіряє B2
          if (KNOWN_DEVIATIONS[`${slug}.${op}.${who}`] !== undefined) continue // знахідка: див. [FINDING-n]
          const response = await ctx.http(method, path, who, body)
          if (response.status === 201 && response.body?.doc?.id) {
            await ctx.payload.delete({ collection: slug as never, id: response.body.doc.id }).catch(() => {})
          }
          const expected = policy.includes(LETTER[who])
          if (allowedStatus(response.status) !== expected) {
            mismatches.push(`${op} як ${who}: очікувано ${expected ? 'дозволено' : 'заборонено'}, отримано ${response.status}`)
          }
          expect(response.status === 501 || response.status < 500, `${slug} ${op} ${who}: помилка сервера ${response.status}`).toBe(true)
        }
      }
      expect(mismatches).toEqual([])
    })
  }

  for (const [slug, rule] of Object.entries(GLOBALS)) {
    it(`глобал ${slug}: ${rule.why}`, async () => {
      for (const who of WHO) {
        const read = await ctx.http('GET', `/globals/${slug}`, who)
        expect(allowedStatus(read.status), `read ${who}`).toBe(rule.read.includes(LETTER[who]))
        const update = await ctx.http('POST', `/globals/${slug}`, who, {})
        expect(allowedStatus(update.status), `update ${who}`).toBe(rule.update.includes(LETTER[who]))
      }
    })
  }

  it('записувані кодом колекції (stock-moves, stock-balances, product-costs, cash-moves): запис заборонено всім, включно з admin', async () => {
    for (const slug of ['stock-moves', 'stock-balances', 'product-costs', 'cash-moves']) {
      for (const who of WHO) {
        for (const [method, path] of [
          ['POST', `/${slug}`],
          ['PATCH', `/${slug}/${MISSING_ID}`],
          ['DELETE', `/${slug}/${MISSING_ID}`],
          ['PATCH', `/${slug}?where[id][exists]=true`],
          ['DELETE', `/${slug}?where[id][exists]=true`],
        ] as const) {
          const response = await ctx.http(method, path, who, method === 'DELETE' ? undefined : {})
          expect(response.status, `${method} ${path} як ${who}`).toBe(403)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// B2. «Своє» і «чуже» на реальних документах
// ---------------------------------------------------------------------------

describe('B2. власні й чужі документи (реальні записи)', () => {
  it('orders: customer читає лише свої; чужий і неіснуючий дають однакову відповідь; гість нічого', async () => {
    const own = await ctx.http('GET', `/orders/${f.orderOwn}`, 'customer')
    const foreign = await ctx.http('GET', `/orders/${f.orderOther}`, 'customer')
    const missing = await ctx.http('GET', `/orders/${MISSING_ID}`, 'customer')
    expect(own.status).toBe(200)
    expect([foreign.status, foreign.body]).toEqual([missing.status, missing.body])
    expect(foreign.status).toBe(404)
    expect((await ctx.http('GET', `/orders/${f.orderOwn}`, 'guest')).status).toBe(403)

    const list = await ctx.http('GET', '/orders?limit=50', 'customer')
    const ids = list.body.docs.map((doc: { id: string }) => String(doc.id))
    expect(ids.sort()).toEqual([f.orderOwn, f.orderOwnLow].sort())
  })

  it('orders: customer не змінює й не видаляє навіть своє замовлення; manager не видаляє', async () => {
    expect((await ctx.http('PATCH', `/orders/${f.orderOwn}`, 'customer', { comment: 'x' })).status).toBe(403)
    expect((await ctx.http('DELETE', `/orders/${f.orderOwn}`, 'customer')).status).toBe(403)
    expect((await ctx.http('DELETE', `/orders/${f.orderOwn}`, 'manager')).status).toBe(403)
    expect((await ctx.http('PATCH', `/orders/${f.orderOther}`, 'customer', { comment: 'x' })).status).toBe(403)
  })

  it('orders: manager бачить усі замовлення (В9)', async () => {
    for (const id of [f.orderOwn, f.orderOther, f.orderOfManager2]) {
      expect((await ctx.http('GET', `/orders/${id}`, 'manager')).status).toBe(200)
    }
  })

  it('users: customer читає лише себе; чужий і неіснуючий id дають однакову відповідь', async () => {
    const { customer, customer2 } = ctx.actors
    expect((await ctx.http('GET', `/users/${customer.id}`, 'customer')).status).toBe(200)
    const foreign = await ctx.http('GET', `/users/${customer2.id}`, 'customer')
    const missing = await ctx.http('GET', `/users/${MISSING_ID}`, 'customer')
    expect([foreign.status, foreign.body]).toEqual([missing.status, missing.body])
    expect(foreign.status).toBe(404)

    const list = await ctx.http('GET', '/users?limit=100', 'customer')
    expect(list.body.docs.map((doc: { id: string }) => String(doc.id))).toEqual([String(customer.id)])
    // Перебір існування за email: чужий email не відрізняється від неіснуючого.
    const probeExisting = await ctx.http('GET', `/users?where[email][equals]=${encodeURIComponent(customer2.email)}`, 'customer')
    const probeMissing = await ctx.http('GET', '/users?where[email][equals]=nobody-r3%40example.test', 'customer')
    expect([probeExisting.status, probeExisting.body.totalDocs]).toEqual([probeMissing.status, probeMissing.body.totalDocs])
  })

  it('users: manager читає себе й клієнтів, але не admin і не інших manager', async () => {
    const { manager, manager2, admin, customer } = ctx.actors
    expect((await ctx.http('GET', `/users/${customer.id}`, 'manager')).status).toBe(200)
    expect((await ctx.http('GET', `/users/${manager.id}`, 'manager')).status).toBe(200)
    expect((await ctx.http('GET', `/users/${manager2.id}`, 'manager')).status).toBe(404)
    expect((await ctx.http('GET', `/users/${admin.id}`, 'manager')).status).toBe(404)
    const list = await ctx.http('GET', '/users?limit=200', 'manager')
    const ids = list.body.docs.map((doc: { id: string }) => String(doc.id))
    expect(ids).not.toContain(String(admin.id))
    expect(ids).not.toContain(String(manager2.id))
  })

  it('users: update і delete чужого користувача заборонені customer і manager; customer змінює себе', async () => {
    const { customer, customer2, manager2 } = ctx.actors
    expect((await ctx.http('PATCH', `/users/${customer2.id}`, 'customer', { name: 'x' })).status).toBe(403)
    expect((await ctx.http('PATCH', `/users/${customer2.id}`, 'manager', { name: 'x' })).status).toBe(403)
    expect((await ctx.http('PATCH', `/users/${manager2.id}`, 'manager', { name: 'x' })).status).toBe(403)
    expect((await ctx.http('DELETE', `/users/${customer2.id}`, 'customer')).status).toBe(403)
    expect((await ctx.http('DELETE', `/users/${customer2.id}`, 'manager')).status).toBe(403)
    expect((await ctx.http('PATCH', `/users/${customer.id}`, 'customer', { name: 'Own' })).status).toBe(200)
  })

  it('carts: власник читає, чужий отримує 404, зміна й видалення чужого заборонені', async () => {
    const { payload, actors } = ctx
    const cart = await payload.create({
      collection: 'carts',
      data: { customer: actors.customer.id, items: [{ product: f.pub, quantity: 1 }], currency: 'MDL' } as never,
    })
    cleanups.push(() => payload.delete({ collection: 'carts', id: cart.id }))
    expect((await ctx.http('GET', `/carts/${cart.id}`, 'customer')).status).toBe(200)
    const other: AuthUser = actors.customer2
    expect((await ctx.http('GET', `/carts/${cart.id}`, other)).status).toBe(404)
    expect((await ctx.http('PATCH', `/carts/${cart.id}`, other, { items: [] })).status).toBe(403)
    expect((await ctx.http('DELETE', `/carts/${cart.id}`, other)).status).toBe(403)
    expect((await ctx.http('GET', `/carts/${cart.id}`, 'guest')).status).toBe(403)
  })

  it('payrolls (В12): manager бачить лише свої проведені; чернетки, чужі й схеми недоступні', async () => {
    const list = await ctx.http('GET', '/payrolls?limit=100', 'manager')
    const ids = list.body.docs.map((doc: { id: string }) => String(doc.id))
    expect(ids).toContain(f.payrollOwnPosted)
    expect(ids).not.toContain(f.payrollOwnDraft)
    expect(ids).not.toContain(f.payrollOtherPosted)

    const foreign = await ctx.http('GET', `/payrolls/${f.payrollOtherPosted}`, 'manager')
    const draft = await ctx.http('GET', `/payrolls/${f.payrollOwnDraft}`, 'manager')
    const missing = await ctx.http('GET', `/payrolls/${MISSING_ID}`, 'manager')
    expect([foreign.status, foreign.body]).toEqual([missing.status, missing.body])
    expect([draft.status, draft.body]).toEqual([missing.status, missing.body])
    expect((await ctx.http('GET', `/payrolls/${f.payrollOwnPosted}`, 'manager')).status).toBe(200)
    expect((await ctx.http('GET', `/salary-schemes?limit=1`, 'manager')).status).toBe(403)

    const all = await ctx.http('GET', '/payrolls?limit=100', 'admin')
    const adminIds = all.body.docs.map((doc: { id: string }) => String(doc.id))
    for (const id of [f.payrollOwnPosted, f.payrollOwnDraft, f.payrollOtherPosted]) expect(adminIds).toContain(id)
    for (const who of ['customer', 'guest'] as const) expect((await ctx.http('GET', '/payrolls', who)).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// C. Поля: що бачить і що може записати кожна роль
// ---------------------------------------------------------------------------

const CUSTOMER_FORBIDDEN = [
  'accounting', 'cogsBani', 'revenueBani', 'stockPostedAt', 'cancelledAt',
  'manager', 'createdBy', 'source', 'warehouse', 'roles', 'hash', 'salt',
]
const MANAGER_FORBIDDEN = ['accounting', 'cogsBani', 'revenueBani', 'stockPostedAt', 'cancelledAt', 'roles', 'hash', 'salt']

const forbiddenKeysIn = (body: unknown, forbidden: string[]) => [...deepKeys(body)].filter((key) => forbidden.includes(key))

describe('C. поля: читання', () => {
  it('customer: власне замовлення без accounting, manager, createdBy, source, warehouse на будь-якій глибині', async () => {
    for (const depth of [0, 1, 3]) {
      const response = await ctx.http('GET', `/orders/${f.orderOwn}?depth=${depth}`, 'customer')
      expect(response.status).toBe(200)
      expect(forbiddenKeysIn(response.body, CUSTOMER_FORBIDDEN), `depth=${depth}`).toEqual([])
    }
    const list = await ctx.http('GET', '/orders?depth=3&limit=50', 'customer')
    expect(forbiddenKeysIn(list.body, CUSTOMER_FORBIDDEN)).toEqual([])
  })

  it('customer: свій профіль без roles і manager; підвантаження join «orders» не повертає accounting', async () => {
    const response = await ctx.http('GET', `/users/${ctx.actors.customer.id}?depth=3`, 'customer')
    expect(response.status).toBe(200)
    expect(forbiddenKeysIn(response.body, CUSTOMER_FORBIDDEN)).toEqual([])
    const me = await ctx.http('GET', '/users/me', 'customer')
    expect(me.status).toBe(200)
    expect(forbiddenKeysIn(me.body, CUSTOMER_FORBIDDEN)).toEqual([])
    // Службові поля автентифікації не віддаються нікому.
    const secrets = ['password', '_verificationToken', 'resetPasswordToken', 'resetPasswordExpiration', 'lockUntil', 'loginAttempts']
    expect(forbiddenKeysIn(me.body, secrets)).toEqual([])
  })

  it('manager: замовлення без accounting на будь-якій глибині, клієнти без roles', async () => {
    for (const id of [f.orderOwn, f.orderOther, f.orderOfManager2]) {
      for (const depth of [0, 2, 3]) {
        const response = await ctx.http('GET', `/orders/${id}?depth=${depth}`, 'manager')
        expect(response.status).toBe(200)
        expect(forbiddenKeysIn(response.body, MANAGER_FORBIDDEN), `${id} depth=${depth}`).toEqual([])
      }
    }
    const list = await ctx.http('GET', '/orders?depth=3&limit=100', 'manager')
    expect(forbiddenKeysIn(list.body, MANAGER_FORBIDDEN)).toEqual([])
    const customers = await ctx.http('GET', '/users?depth=2&limit=100', 'manager')
    expect(forbiddenKeysIn(customers.body, ['roles', 'hash', 'salt'])).toEqual([])
  })

  it('manager: чужий manager у знімку замовлення не розкривається як документ користувача', async () => {
    const response = await ctx.http('GET', `/orders/${f.orderOfManager2}?depth=3`, 'manager')
    const snapshot = response.body.manager
    expect(snapshot && typeof snapshot === 'object' ? 'email' in snapshot : false).toBe(false)
  })

  it('manager: собівартість недоступна (product-costs, stock-moves, ендпоінт залишків без вартості)', async () => {
    for (const path of ['/product-costs', '/stock-moves', '/cash-moves', '/salary-schemes']) {
      expect((await ctx.http('GET', path, 'manager')).status, path).toBe(403)
    }
    const stock = await ctx.http('GET', `/stock/product/${f.pub}`, 'manager')
    expect(stock.status).toBe(200)
    expect(Object.keys(stock.body).sort()).toEqual(['productId', 'totalQty', 'warehouses'])
    const admin = await ctx.http('GET', `/stock/product/${f.pub}`, 'admin')
    expect(Object.keys(admin.body)).toEqual(expect.arrayContaining(['valueBani', 'avgCostBani']))
  })

  it('manager: свій проведений payroll на глибині 3 без roles, hash, salt і чужих схем', async () => {
    const response = await ctx.http('GET', `/payrolls/${f.payrollOwnPosted}?depth=3`, 'manager')
    expect(response.status).toBe(200)
    expect(forbiddenKeysIn(response.body, ['roles', 'hash', 'salt', 'accounting'])).toEqual([])
  })

  it('wholesalePrice: admin, manager і оптовик бачать; роздрібний клієнт і гість ні (REST list, одиночний ендпоінт)', async () => {
    const seen: Record<string, boolean> = {}
    const who: Array<[string, Who | AuthUser]> = [
      ['guest', 'guest'], ['customer', 'customer'], ['wholesale', wholesaleCustomer], ['manager', 'manager'], ['admin', 'admin'],
    ]
    for (const [label, user] of who) {
      const list = await ctx.http('GET', `/products?where[id][equals]=${f.pub}&depth=2`, user)
      const single = await ctx.http('GET', `/products/${f.pub}`, user)
      seen[`${label}:list`] = list.body.docs?.[0]?.wholesalePrice !== undefined
      seen[`${label}:single`] = single.body?.wholesalePrice !== undefined
    }
    expect(seen).toEqual({
      'guest:list': false, 'guest:single': false,
      'customer:list': false, 'customer:single': false,
      'wholesale:list': true, 'wholesale:single': true,
      // Публічний одиночний ендпоінт показує оптову ціну лише admin і оптовику (canUserReadWholesalePrice); manager бачить її в адмінці (list).
      'manager:list': true, 'manager:single': false,
      'admin:list': true, 'admin:single': true,
    })
  })

  it('wholesalePrice не просочується через підвантаження (замовлення, кошики, обране) для роздрібного клієнта', async () => {
    const order = await ctx.http('GET', `/orders/${f.orderOwn}?depth=4`, 'customer')
    expect(forbiddenKeysIn(order.body, ['wholesalePrice'])).toEqual([])
    const guestList = await ctx.http('GET', '/products?depth=4&limit=100', 'guest')
    expect(forbiddenKeysIn(guestList.body, ['wholesalePrice', 'accounting'])).toEqual([])
  })
})

describe('C. поля: запис', () => {
  it('manager не записує retailPrice і wholesalePrice (зберігає чернетку з описовими полями)', async () => {
    const response = await ctx.http('PATCH', `/products/${f.pub2}?draft=true`, 'manager', {
      retailPrice: 1, wholesalePrice: 1, subtitle: `${tag} by manager`,
    })
    expect(response.status).toBe(200)
    const latest = await ctx.payload.findByID({ collection: 'products', id: f.pub2, draft: true })
    expect(latest.subtitle).toBe(`${tag} by manager`)
    expect([latest.retailPrice, latest.wholesalePrice]).toEqual([200, 10])
  })

  it('manager не задає ціну позиції Orders.items.price: ціну ставить сервер за каталогом', async () => {
    const response = await ctx.http('POST', '/orders', 'manager', {
      items: [{ product: f.pub, quantity: 2, price: 1 }], total: 1, warehouse: f.warehouse,
    })
    expect(response.status).toBe(201)
    orderIds.push(String(response.body.doc.id))
    const saved = await ctx.payload.findByID({ collection: 'orders', id: response.body.doc.id, depth: 0 })
    expect(saved.items?.[0].price).toBe(100)
    expect(saved.total).toBe(200)
  })

  it('manager не підробляє знімок менеджера, автора й джерело замовлення', async () => {
    const response = await ctx.http('POST', '/orders', 'manager', {
      items: [{ product: f.pub, quantity: 1 }], warehouse: f.warehouse,
      manager: String(ctx.actors.manager2.id), createdBy: String(ctx.actors.admin.id), source: 'web',
    })
    expect(response.status).toBe(201)
    orderIds.push(String(response.body.doc.id))
    const saved = await ctx.payload.findByID({ collection: 'orders', id: response.body.doc.id, depth: 0 })
    expect(String(saved.createdBy)).toBe(String(ctx.actors.manager.id))
    expect(saved.source).toBe('admin')
    expect(saved.manager ? String(saved.manager) : null).not.toBe(String(ctx.actors.manager2.id))
  })

  it('manager створює клієнта лише з roles = [customer] і manager = він сам, без wholesale і brandDiscounts', async () => {
    const email = `${tag}-mk-${Date.now()}@example.test`
    const response = await ctx.http('POST', '/users', 'manager', {
      email, password: PASSWORD, name: 'A', surname: 'B', phone: '1',
      roles: ['admin', 'manager'], wholesale: true, manager: String(ctx.actors.manager2.id),
      brandDiscounts: [{ brand: f.brand, discountPercent: 50 }],
    })
    expect(response.status).toBe(201)
    const saved = await ctx.payload.findByID({ collection: 'users', id: response.body.doc.id, depth: 0, overrideAccess: true })
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: saved.id }))
    expect(saved.roles).toEqual(['customer'])
    expect(String(saved.manager)).toBe(String(ctx.actors.manager.id))
    expect(saved.wholesale).toBe(false)
    expect(saved.brandDiscounts ?? []).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// F. Mass assignment
// ---------------------------------------------------------------------------

const registerAsGuest = async (extra: Record<string, unknown>) => {
  const email = `${tag}-reg-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
  const response = await ctx.http('POST', '/users', 'guest', {
    email, password: PASSWORD, name: 'R', surname: 'G', phone: '1', ...extra,
  })
  const doc = (
    await ctx.payload.find({ collection: 'users', where: { email: { equals: email } }, showHiddenFields: true, depth: 0, overrideAccess: true })
  ).docs[0] as Record<string, any> | undefined
  if (doc) cleanups.push(() => ctx.payload.delete({ collection: 'users', id: doc.id }))
  return { response, doc }
}

describe('F. mass assignment', () => {
  it('реєстрація гостя ігнорує roles, manager, _verified і службові поля автентифікації', async () => {
    const { response, doc } = await registerAsGuest({
      roles: ['admin'], manager: String(ctx.actors.manager.id), _verified: true,
      _verificationToken: 'attacker-token', resetPasswordToken: 'attacker-reset',
      resetPasswordExpiration: new Date(Date.now() + 3_600_000).toISOString(),
      loginAttempts: 0, lockUntil: null, hash: 'attacker-hash', salt: 'attacker-salt',
    })
    expect(response.status).toBe(201)
    expect(doc).toBeDefined()
    expect(doc!.roles).toEqual(['customer'])
    expect(doc!.manager ?? null).toBeNull()
    expect(doc!._verified).toBe(false)
    expect(doc!._verificationToken).not.toBe('attacker-token')
    expect(doc!.hash).not.toBe('attacker-hash')
    expect(doc!.salt).not.toBe('attacker-salt')
  })

  it('відповідь на реєстрацію не містить roles, manager, токенів, hash і salt', async () => {
    const { response } = await registerAsGuest({})
    expect(forbiddenKeysIn(response.body, [...CUSTOMER_FORBIDDEN, '_verificationToken', 'resetPasswordToken', 'password'])).toEqual([])
  })

  it('customer PATCH на себе не змінює roles і manager', async () => {
    const { customer } = ctx.actors
    const before = await ctx.payload.findByID({ collection: 'users', id: customer.id, depth: 0, overrideAccess: true })
    for (const body of [{ roles: ['admin'] }, { roles: ['manager', 'customer'] }, { manager: String(ctx.actors.manager.id) }]) {
      await ctx.http('PATCH', `/users/${customer.id}`, 'customer', body)
    }
    const after = await ctx.payload.findByID({ collection: 'users', id: customer.id, depth: 0, overrideAccess: true })
    expect(after.roles).toEqual(before.roles)
    expect(after.manager ?? null).toEqual(before.manager ?? null)
  })

  it('updateUserInfo: білий список полів; roles, manager, wholesale, brandDiscounts, email, _verified не змінюються', async () => {
    const user = await ctx.makeUser(['customer'])
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: user.id }))
    const response = await ctx.http('PATCH', '/users/update', user, {
      name: 'Upd', city: 'Balti',
      roles: ['admin'], manager: String(ctx.actors.manager.id), wholesale: true,
      brandDiscounts: [{ brand: f.brand, discountPercent: 50 }], email: `${tag}-x@example.test`, _verified: false,
    })
    expect(response.status).toBe(200)
    const saved = await ctx.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
    expect([saved.name, saved.city]).toEqual(['Upd', 'Balti'])
    expect(saved.roles).toEqual(['customer'])
    expect(saved.manager ?? null).toBeNull()
    expect(saved.wholesale).toBe(false)
    expect(saved.brandDiscounts ?? []).toEqual([])
    expect(saved.email).toBe(user.email)
    expect((saved as unknown as Record<string, unknown>)._verified).toBe(true)
    expect(forbiddenKeysIn(response.body, [...CUSTOMER_FORBIDDEN, 'password'])).toEqual([])
  })

  const dangerousOrder = (fxProduct: string) => ({
    items: [{ product: fxProduct, quantity: 1, price: 1 }],
    shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
    total: 1, discount: 99, status: 'shipped', warehouse: 'x', manager: '', source: 'admin', createdBy: '',
    accounting: { cogsBani: 1, revenueBani: 1, stockPostedAt: '2001-01-01T00:00:00.000Z' },
    paidBani: 100, paymentState: 'paid', customer: '', orderNumber: '1', telegramMessageId: 'z',
  })

  it('createOrder (гість і customer) ігнорує warehouse, manager, source, createdBy, accounting, status, price, total, discount, paid*', async () => {
    const withManager = await ctx.makeUser(['customer'], { manager: String(ctx.actors.manager.id) })
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: withManager.id }))
    const settings = await ctx.payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    const expectedWarehouse = settings.defaultWebWarehouse ? idOf(settings.defaultWebWarehouse) : null

    for (const [who, owner] of [['guest', null], ['customer', ctx.actors.customer], [withManager, withManager]] as const) {
      const body = dangerousOrder(f.pub)
      body.manager = String(ctx.actors.manager2.id)
      body.createdBy = String(ctx.actors.admin.id)
      body.customer = String(ctx.actors.customer2.id)
      const response = await ctx.http('POST', '/orders/create', who, body)
      expect(response.status, String(typeof who === 'string' ? who : 'customer з manager')).toBe(201)
      orderIds.push(String(response.body.order.id))
      const saved = await ctx.payload.findByID({ collection: 'orders', id: response.body.order.id, depth: 0, overrideAccess: true })

      expect(saved.total).toBe(100)
      expect(saved.discount ?? 0).toBe(0)
      expect(saved.status).toBe('pending')
      expect(saved.items?.[0].price).toBe(100)
      expect(saved.source).toBe('web')
      expect(saved.createdBy ?? null).toBeNull()
      expect(saved.paidBani).toBe(0)
      expect(saved.paymentState).toBe('unpaid')
      expect(saved.orderNumber).not.toBe('1')
      expect(saved.telegramMessageId ?? null).not.toBe('z')
      expect(saved.accounting?.stockPostedAt ?? null).toBeNull()
      expect(saved.accounting?.cogsBani ?? null).toBeNull()
      expect(saved.accounting?.revenueBani).toBe(10000)
      expect(saved.warehouse ? idOf(saved.warehouse) : null).toBe(expectedWarehouse)
      expect(saved.customer ? idOf(saved.customer) : null).toBe(owner ? String(owner.id) : null)
      expect(saved.manager ? idOf(saved.manager) : null).toBe(owner === withManager ? String(ctx.actors.manager.id) : null)
    }
  })

  it('createOrder: відповідь містить лише id, номер і позиції без внутрішніх полів', async () => {
    const response = await ctx.http('POST', '/orders/create', 'guest', {
      items: [{ product: f.pub, quantity: 1 }],
      shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
    })
    expect(response.status).toBe(201)
    orderIds.push(String(response.body.order.id))
    expect(Object.keys(response.body).sort()).toEqual(['order', 'success'])
    expect(Object.keys(response.body.order).sort()).toEqual(['id', 'items', 'orderNumber'])
    for (const key of Object.keys(response.body.order.items[0])) expect(['article', 'price', 'quantity', 'subtitle', 'title']).toContain(key)
  })

  it('carts/merge: тіло не змінює власника кошика й не вставляє чужі поля', async () => {
    const user = await ctx.makeUser(['customer'])
    cleanups.push(async () => {
      await ctx.payload.delete({ collection: 'carts', where: { customer: { equals: user.id } } })
      await ctx.payload.delete({ collection: 'users', id: user.id })
    })
    const response = await ctx.http('POST', '/carts/merge', user, {
      items: [{ product: { id: f.pub }, quantity: 1, price: 1, subtotal: 1, customer: String(ctx.actors.customer2.id) }],
      customer: String(ctx.actors.customer2.id),
    })
    expect(response.status).toBe(200)
    const carts = await ctx.payload.find({ collection: 'carts', where: { customer: { equals: user.id } }, depth: 0, overrideAccess: true })
    expect(carts.totalDocs).toBe(1)
    const foreign = await ctx.payload.find({ collection: 'carts', where: { customer: { equals: ctx.actors.customer2.id } }, depth: 0, overrideAccess: true })
    expect(foreign.docs.some((cart) => (cart.items ?? []).some((item) => idOf(item.product) === f.pub))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G. Ескалація привілеїв
// ---------------------------------------------------------------------------

describe('G. ескалація: customer не стає manager чи admin, manager не підвищує себе', () => {
  it('forgot-password і reset-password не змінюють roles, wholesale, manager', async () => {
    const user = await ctx.makeUser(['customer'])
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: user.id }))
    const forgot = await ctx.http('POST', '/users/forgot-password', 'guest', { email: user.email, roles: ['admin'] })
    expect(forgot.status).toBe(200)
    const withToken = (await ctx.payload.findByID({ collection: 'users', id: user.id, showHiddenFields: true, depth: 0, overrideAccess: true })) as unknown as Record<string, any>
    expect(typeof withToken.resetPasswordToken).toBe('string')
    // Токен не повертається у відповіді на запит скидання.
    expect(JSON.stringify(forgot.body)).not.toContain(withToken.resetPasswordToken)

    const reset = await ctx.http('POST', '/users/reset-password', 'guest', {
      token: withToken.resetPasswordToken, password: 'New-password-123456',
      roles: ['admin'], wholesale: true, manager: String(ctx.actors.manager.id),
    })
    expect(reset.status).toBe(200)
    const saved = await ctx.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
    expect(saved.roles).toEqual(['customer'])
    expect(saved.wholesale).toBe(false)
    expect(saved.manager ?? null).toBeNull()
  })

  it('forgot-password відповідає однаково для наявного й неіснуючого email', async () => {
    const existing = await ctx.http('POST', '/users/forgot-password', 'guest', { email: ctx.actors.customer.email })
    const missing = await ctx.http('POST', '/users/forgot-password', 'guest', { email: `nobody-${tag}@example.test` })
    expect([existing.status, existing.body]).toEqual([missing.status, missing.body])
  })

  it('manager не змінює власні й чужі ролі', async () => {
    const { manager, manager2, admin, customer } = ctx.actors
    for (const target of [manager, manager2, admin, customer]) {
      await ctx.http('PATCH', `/users/${target.id}`, 'manager', { roles: ['admin'], wholesale: true })
    }
    for (const [target, roles] of [[manager, ['manager']], [manager2, ['manager']], [admin, ['admin']], [customer, ['customer']]] as const) {
      expect((await ctx.payload.findByID({ collection: 'users', id: target.id, depth: 0, overrideAccess: true })).roles).toEqual(roles)
    }
  })

  it('manager не створює admin і manager: roles примусово [customer]', async () => {
    for (const roles of [['admin'], ['manager'], ['admin', 'manager', 'customer']]) {
      const email = `${tag}-esc-${Math.floor(Math.random() * 1e9)}@example.test`
      const response = await ctx.http('POST', '/users', 'manager', { email, password: PASSWORD, name: 'E', surname: 'S', phone: '1', roles })
      expect(response.status).toBe(201)
      const saved = await ctx.payload.findByID({ collection: 'users', id: response.body.doc.id, depth: 0, overrideAccess: true })
      cleanups.push(() => ctx.payload.delete({ collection: 'users', id: saved.id }))
      expect(saved.roles).toEqual(['customer'])
    }
  })

  it('duplicate: гість і customer не клонують admin чи manager, manager не клонує admin; копія клієнта не успадковує wholesale', async () => {
    const countUsers = async () => (await ctx.payload.count({ collection: 'users', overrideAccess: true })).totalDocs
    const before = await countUsers()
    for (const [who, target] of [
      ['guest', ctx.actors.admin], ['customer', ctx.actors.admin], ['customer', ctx.actors.manager],
      ['manager', ctx.actors.admin], ['manager', ctx.actors.manager2],
    ] as const) {
      const response = await ctx.http('POST', `/users/${target.id}/duplicate`, who)
      expect(response.status, `${who} -> ${target.id}`).toBeGreaterThanOrEqual(400)
    }
    expect(await countUsers()).toBe(before)

    const wholesale = await ctx.makeUser(['customer'], { wholesale: true })
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: wholesale.id }))
    const copy = await ctx.http('POST', `/users/${wholesale.id}/duplicate`, 'manager')
    if (copy.status < 300) {
      const saved = await ctx.payload.findByID({ collection: 'users', id: copy.body.doc.id, depth: 0, overrideAccess: true })
      cleanups.push(() => ctx.payload.delete({ collection: 'users', id: saved.id }))
      expect(saved.roles).toEqual(['customer'])
      expect(saved.wholesale).toBe(false)
    }
  })

  it('first-register закритий, коли користувачі вже є', async () => {
    const before = (await ctx.payload.count({ collection: 'users', overrideAccess: true })).totalDocs
    const response = await ctx.http('POST', '/users/first-register', 'guest', {
      email: `${tag}-first@example.test`, password: PASSWORD, name: 'F', surname: 'R', phone: '1',
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect((await ctx.payload.count({ collection: 'users', overrideAccess: true })).totalDocs).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// H. Канали витоку через запити
// ---------------------------------------------------------------------------

const idList = (body: { docs?: Array<{ id: string }> }) => (body.docs ?? []).map((doc) => String(doc.id))

describe('H. where / sort / count / distinct не відкривають закритого', () => {
  const FORBIDDEN_WHERE: Array<[Who, string, string]> = [
    ['customer', '/orders', 'where[accounting.cogsBani][greater_than]=0'],
    ['customer', '/orders', 'where[accounting.revenueBani][greater_than]=0'],
    ['customer', '/orders', 'where[manager][exists]=true'],
    ['customer', '/orders', 'where[createdBy][exists]=true'],
    ['customer', '/orders', 'where[source][equals]=admin'],
    ['customer', '/orders', 'where[warehouse][exists]=true'],
    ['customer', '/orders', 'where[customer.roles][contains]=admin'],
    ['manager', '/orders', 'where[accounting.cogsBani][greater_than]=0'],
    ['manager', '/orders', 'where[accounting.stockPostedAt][exists]=true'],
    ['manager', '/users', 'where[roles][contains]=admin'],
    ['guest', '/products', 'where[wholesalePrice][greater_than]=0'],
    ['customer', '/products', 'where[wholesalePrice][greater_than]=0'],
    ['customer', '/users', 'where[manager][exists]=true'],
    ['customer', '/users', 'where[roles][contains]=admin'],
  ]

  it.each(FORBIDDEN_WHERE)('%s: %s?%s відхиляється (QueryError), а не фільтрує', async (who, path, query) => {
    const response = await ctx.http('GET', `${path}?${query}`, who)
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).toContain('cannot be queried')
  })

  it('count: з забороненим полем у where 400, без where рахує лише доступне; гість 403', async () => {
    const mine = (await ctx.payload.count({ collection: 'orders', where: { customer: { equals: ctx.actors.customer.id } }, overrideAccess: true })).totalDocs
    const own = await ctx.http('GET', '/orders/count', 'customer')
    expect(own.body.totalDocs).toBe(mine)
    expect((await ctx.http('GET', '/orders/count?where[accounting.cogsBani][greater_than]=0', 'customer')).status).toBe(400)
    expect((await ctx.http('GET', '/orders/count?where[accounting.cogsBani][greater_than]=0', 'manager')).status).toBe(400)
    expect((await ctx.http('GET', '/orders/count', 'guest')).status).toBe(403)
    expect((await ctx.http('GET', '/users/count', 'customer')).body.totalDocs).toBe(1)
  })

  it('перебір чужих записів через where: чужий номер замовлення не відрізняється від неіснуючого', async () => {
    const other = await ctx.payload.findByID({ collection: 'orders', id: f.orderOther, depth: 0, overrideAccess: true })
    const existing = await ctx.http('GET', `/orders?where[orderNumber][equals]=${other.orderNumber}`, 'customer')
    const missing = await ctx.http('GET', '/orders?where[orderNumber][equals]=nonexistent-r3', 'customer')
    expect([existing.status, existing.body.totalDocs]).toEqual([missing.status, missing.body.totalDocs])
    expect(existing.body.totalDocs).toBe(0)
  })

  it('find-distinct у Payload 3.65.0 не доступний через REST', async () => {
    for (const path of ['/orders/distinct?field=accounting.cogsBani', '/users/distinct?field=roles', '/products/distinct?field=wholesalePrice']) {
      const response = await ctx.http('GET', path, 'customer')
      expect(response.status, path).not.toBe(200)
    }
  })

  it('документи без доступу не потрапляють у списки навіть при depth=3 і limit=0', async () => {
    const list = await ctx.http('GET', '/orders?depth=3&limit=0', 'customer')
    const mine = await ctx.payload.find({ collection: 'orders', where: { customer: { equals: ctx.actors.customer.id } }, pagination: false, depth: 0, overrideAccess: true })
    expect(idList(list.body).sort()).toEqual(idList(mine as never).sort())
    expect(idList(list.body)).not.toContain(f.orderOther)
  })
})

// ---------------------------------------------------------------------------
// I. Масові операції, versions, drafts
// ---------------------------------------------------------------------------

describe('I. масові PATCH і DELETE за where, versions, drafts', () => {
  it('customer: PATCH /users?where зачіпає лише його самого', async () => {
    const { customer, customer2 } = ctx.actors
    await ctx.http('PATCH', '/users?where[email][exists]=true', 'customer', { name: `${tag} mass` })
    expect((await ctx.payload.findByID({ collection: 'users', id: customer.id, depth: 0, overrideAccess: true })).name).toBe(`${tag} mass`)
    expect((await ctx.payload.findByID({ collection: 'users', id: customer2.id, depth: 0, overrideAccess: true })).name).not.toBe(`${tag} mass`)
    await ctx.http('PATCH', `/users/${customer.id}`, 'customer', { name: 'Test' })
  })

  it('масові DELETE і PATCH за where заборонені гостю й customer на закритих колекціях', async () => {
    for (const slug of ['users', 'orders', 'carts', 'products', 'promo-codes', 'warehouses', 'purchases', 'payrolls', 'cash-operations']) {
      for (const who of ['guest', 'customer'] as const) {
        for (const method of ['DELETE', 'PATCH'] as const) {
          const response = await ctx.http(method, `/${slug}?where[id][exists]=true`, who, method === 'PATCH' ? { comment: 'x' } : undefined)
          // carts і users: customer має доступ «лише своє», тому 200 допустимий, але чужого він не зачіпає (перевірено вище).
          if (slug === 'carts' && who === 'customer') continue
          if (slug === 'users' && who === 'customer' && method === 'PATCH') continue
          expect(response.status, `${method} /${slug} як ${who}`).toBe(403)
        }
      }
    }
    expect((await ctx.payload.count({ collection: 'users', overrideAccess: true })).totalDocs).toBeGreaterThan(3)
  })

  it('customer: масове видалення кошиків зачіпає лише його кошики', async () => {
    const make = (customer: string) => ctx.payload.create({ collection: 'carts', data: { customer, items: [], currency: 'MDL' } as never })
    const mine = await make(String(ctx.actors.customer.id))
    const foreign = await make(String(ctx.actors.customer2.id))
    cleanups.push(() => ctx.payload.delete({ collection: 'carts', id: foreign.id }))
    await ctx.http('DELETE', '/carts?where[id][exists]=true', 'customer')
    expect(await ctx.payload.findByID({ collection: 'carts', id: foreign.id, overrideAccess: true }).then(() => true).catch(() => false)).toBe(true)
    await ctx.payload.delete({ collection: 'carts', id: mine.id }).catch(() => {})
  })

  it('manager: масове скасування й видалення замовлень не проходить (В5, В9)', async () => {
    const created = []
    for (let i = 0; i < 2; i += 1) {
      const order = await ctx.payload.create({
        collection: 'orders', user: ctx.actors.admin, depth: 0,
        data: { items: [{ product: f.pub, quantity: 1, price: 0 }], total: 0, warehouse: f.warehouse, comment: `${tag}-bulk` } as never,
      })
      orderIds.push(String(order.id))
      created.push(String(order.id))
    }
    const cancel = await ctx.http('PATCH', `/orders?where[comment][equals]=${tag}-bulk`, 'manager', { status: 'cancelled' })
    expect(cancel.status).toBeGreaterThanOrEqual(400)
    for (const id of created) {
      expect((await ctx.payload.findByID({ collection: 'orders', id, depth: 0, overrideAccess: true })).status).toBe('pending')
    }
    expect((await ctx.http('DELETE', `/orders?where[comment][equals]=${tag}-bulk`, 'manager')).status).toBe(403)
    expect((await ctx.payload.count({ collection: 'orders', where: { comment: { equals: `${tag}-bulk` } }, overrideAccess: true })).totalDocs).toBe(2)
  })

  it('manager: масова зміна товарів без чернетки відхиляється, ціни не змінюються', async () => {
    const response = await ctx.http('PATCH', `/products?where[id][equals]=${f.pub}`, 'manager', { retailPrice: 1 })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect((await ctx.payload.findByID({ collection: 'products', id: f.pub, depth: 0 })).retailPrice).toBe(100)
  })

  it('drafts: гість і customer не отримують чернеток через ?draft=true; versions гостю недоступні', async () => {
    for (const who of ['guest', 'customer'] as const) {
      const list = await ctx.http('GET', `/products?draft=true&where[id][equals]=${f.draft}`, who)
      expect(idList(list.body), who).toEqual([])
    }
    const version = (await ctx.payload.findVersions({ collection: 'products', where: { parent: { equals: f.draft } }, overrideAccess: true })).docs[0]
    expect(version).toBeDefined()
    expect((await ctx.http('GET', `/products/versions/${version.id}`, 'guest')).status).toBe(403)
    expect((await ctx.http('POST', `/products/versions/${version.id}`, 'customer', {})).status).toBe(403)
    expect((await ctx.http('POST', `/products/versions/${version.id}`, 'guest', {})).status).toBe(403)
  })

  it('versions: колекції без версій не віддають помилку з деталями реалізації (500 не повертають)', async () => {
    // Фіксуємо фактичну поведінку: для колекцій без versions Payload віддає загальну 500 «Something went wrong».
    // Це гігієна (FINDING-14), а не витік: тіло не містить slug чи стеку.
    const response = await ctx.http('GET', '/orders/versions', 'customer')
    expect(JSON.stringify(response.body)).not.toMatch(/orders|stack|node_modules/i)
  })
})

// ---------------------------------------------------------------------------
// D. Ендпоінти
// ---------------------------------------------------------------------------

const matches = (check: number | ((status: number) => boolean), status: number) =>
  typeof check === 'number' ? status === check : check(status)

const ERROR_BODY_KEYS = ['message', 'code', 'errors', 'error', 'name', 'data']

describe('D. ендпоінти: хто допущений, чому, який статус', () => {
  it('таблиця повна: кожен ендпоінт проєкту й плагінів має запис (новий ендпоінт без запису = червоний тест)', async () => {
    const actual = (await inventoryEndpoints(ctx.payload.config))
      .filter((row) => row.kind !== 'builtin')
      .map((row) => `${row.method} ${row.url}`)
      .sort()
    expect(actual).toEqual(ENDPOINTS.map((row) => row.key).sort())
  })

  it('кожен запис має причину, а публічні ендпоінти позначені явно', () => {
    for (const row of ENDPOINTS) {
      expect(row.why.length, row.key).toBeGreaterThan(10)
      if (row.access === 'public') expect(row.expect.guest, `${row.key}: публічний ендпоінт відповідає гостю`).not.toBe(401)
    }
    const publicEndpoints = ENDPOINTS.filter((row) => row.access === 'public').map((row) => row.key)
    expect(publicEndpoints).toContain('POST /orders/create')
  })

  describe('статуси для гостя, customer, manager, admin', () => {
    beforeAll(() => {
      const users = [ctx.actors.customer.id, ctx.actors.manager.id, ctx.actors.admin.id]
      cleanups.push(() => ctx.payload.delete({ collection: 'carts', where: { customer: { in: users } } }))
    })

    for (const row of ENDPOINTS) {
      it(`${row.key} [${row.access}]: ${row.why}`, async () => {
        const mismatches: string[] = []
        for (const who of WHO) {
          if (row.skip?.[who]) continue
          const request = row.request(fx)
          const response = await ctx.http(request.method, request.path, who, request.body)
          if (response.body?.order?.id) orderIds.push(String(response.body.order.id))
          const accepted = matches(row.expect[who], response.status) || row.knownDeviation?.status === response.status
          if (!accepted) {
            mismatches.push(`${who}: отримано ${response.status}, очікувано ${String(row.expect[who])}`)
          }
        }
        expect(mismatches).toEqual([])
      })
    }
  })

  describe('першою діє перевірка ролі (до читання даних і валідації)', () => {
    for (const row of ENDPOINTS.filter((item) => item.garbage)) {
      it(`${row.key}: хибні параметри не змінюють відмову 401/403`, async () => {
        const garbage = row.garbage!
        const mismatches: string[] = []
        for (const who of WHO) {
          const expected = row.expect[who]
          if (typeof expected !== 'number' || ![401, 403].includes(expected)) continue
          if (row.roleFirstFinding?.[who]) continue // відома знахідка: див. [FINDING-n]
          const response = await ctx.http(garbage.method, garbage.path, who, garbage.body)
          if (response.status !== expected) mismatches.push(`${who}: ${response.status} замість ${expected}`)
          const extra = Object.keys(response.body ?? {}).filter((key) => !ERROR_BODY_KEYS.includes(key))
          if (extra.length) mismatches.push(`${who}: відмова містить зайві поля ${extra.join(', ')}`)
        }
        expect(mismatches).toEqual([])
      })
    }

    it('відмова не розкриває існування запису: товар є й товару немає дають однакову відповідь customer', async () => {
      for (const who of ['guest', 'customer'] as const) {
        const existing = await ctx.http('GET', `/stock/product/${f.pub}`, who)
        const missing = await ctx.http('GET', `/stock/product/${MISSING_ID}`, who)
        expect([existing.status, existing.body]).toEqual([missing.status, missing.body])
      }
    })
  })

  describe('відповіді не містять зайвих полів', () => {
    it('GET /orders/my: лише нормалізовані поля, без accounting, manager, warehouse, source', async () => {
      const response = await ctx.http('GET', '/orders/my', 'customer')
      expect(response.status).toBe(200)
      const allowed = ['id', 'createdAt', 'orderNumber', 'total', 'status', 'promoCodeApplied', 'discount', 'items']
      const itemKeys = ['id', 'title', 'subtitle', 'article', 'slug', 'price', 'quantity', 'thumbnail']
      expect(response.body.docs.length).toBeGreaterThan(0)
      for (const doc of response.body.docs) {
        for (const key of Object.keys(doc)) expect(allowed, key).toContain(key)
        for (const item of doc.items) for (const key of Object.keys(item)) expect(itemKeys, key).toContain(key)
      }
      expect(response.body.docs.map((doc: { id: string }) => String(doc.id))).not.toContain(f.orderOther)
    })

    it('PATCH /users/update: відповідь без roles, manager, hash, salt, токенів', async () => {
      const response = await ctx.http('PATCH', '/users/update', 'customer', { city: 'Chisinau' })
      expect(response.status).toBe(200)
      expect(forbiddenKeysIn(response.body, [...CUSTOMER_FORBIDDEN, '_verificationToken', 'resetPasswordToken', 'password'])).toEqual([])
    })

    it('GET /users/favorites: роздрібному клієнту без wholesalePrice', async () => {
      await ctx.http('POST', '/users/favorites', 'customer', { id: f.pub })
      const response = await ctx.http('GET', '/users/favorites', 'customer')
      expect(response.status).toBe(200)
      expect(forbiddenKeysIn(response.body, ['wholesalePrice', 'accounting'])).toEqual([])
      await ctx.http('DELETE', `/users/favorites/${f.pub}`, 'customer')
    })

    it('GET /carts/me: без wholesalePrice, accounting та чужих даних', async () => {
      await ctx.http('POST', '/carts/add-item', 'customer', { item: { productId: f.pub, quantity: 1 } })
      const response = await ctx.http('GET', '/carts/me', 'customer')
      expect(response.status).toBe(200)
      expect(forbiddenKeysIn(response.body, ['wholesalePrice', 'accounting', 'roles', 'manager'])).toEqual([])
      await ctx.http('POST', '/carts/clear', 'customer', {})
    })
  })

  it('L: усі шість /api/reports/* і кеш-перевірки лише admin (admin 200, manager 403, customer 403, гість 401)', async () => {
    const protectedRows = ENDPOINTS.filter((row) => row.key.startsWith('GET /reports/') || row.access === 'admin')
    expect(protectedRows.length).toBeGreaterThanOrEqual(10)
    for (const row of protectedRows) {
      expect([row.expect.guest, row.expect.customer, row.expect.manager], row.key).toEqual([401, 403, 403])
    }
  })
})

// ---------------------------------------------------------------------------
// E. Local API в ендпоінтах і сервісах
// ---------------------------------------------------------------------------

describe('E. Local API: overrideAccess і джерело параметрів', () => {
  const scan = async () => {
    const custom = (await inventoryEndpoints(ctx.payload.config)).filter((row) => row.kind === 'custom')
    const files = endpointClosure([...new Set(custom.map((row) => row.file))])
    const seen = new Map<string, number>()
    return scanLocalApi(files).map((call) => {
      const base = `${call.file.replace(/^src\//, '')}:${call.op}:${call.collection}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { ...call, key: `${base}#${n}` }
    })
  }

  it('кожен виклик з дефолтним (true) або явним overrideAccess: true класифіковано; нових без рішення немає', async () => {
    const calls = await scan()
    const unreviewed = calls
      .filter((call) => call.overrideAccess !== 'false' && !(call.key in LOCAL_API_REVIEW))
      .map((call) => `${call.key} (${call.file}:${call.line}) ${call.source}`)
    expect(unreviewed).toEqual([])
  })

  it('таблиця не містить застарілих рядків', async () => {
    const keys = new Set((await scan()).map((call) => call.key))
    expect(Object.keys(LOCAL_API_REVIEW).filter((key) => !keys.has(key))).toEqual([])
  })

  it('виклики з overrideAccess: false передають user (інакше права ігноруються)', async () => {
    const strict = (await scan()).filter((call) => call.overrideAccess === 'false')
    expect(strict.length).toBeGreaterThan(0)
    for (const call of strict) expect(call.user, `${call.file}:${call.line}`).toBe(true)
  })

  it('усі FINDING у класифікації мають відповідний блок [FINDING-n] у цьому файлі', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const defined = new Set([...source.matchAll(/describe\('\[FINDING-(\d+)\]/g)].map((match) => Number(match[1])))
    const referenced = new Set<number>([
      ...Object.values(KNOWN_DEVIATIONS),
      ...Object.values(DEFAULT_ACCESS_FINDINGS),
      ...Object.values(LOCAL_API_REVIEW).filter((value) => value.startsWith('FINDING-')).map((value) => Number(value.slice(8))),
      ...ENDPOINTS.flatMap((row) => Object.values(row.roleFirstFinding ?? {})),
    ])
    for (const number of referenced) expect(defined.has(number), `FINDING-${number}`).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// J. GraphQL
// ---------------------------------------------------------------------------

describe('J. GraphQL: ті самі права, introspection у production', () => {
  const forbidden = (response: { body: any }, root: string) =>
    response.body?.data?.[root] === null && response.body?.errors?.[0]?.extensions?.name === 'Forbidden'

  it('introspection і playground вимкнено в production (дефолт Payload 3.65.0, не перевизначений)', () => {
    expect(ctx.payload.config.graphQL.disableIntrospectionInProduction).toBe(true)
    expect(ctx.payload.config.graphQL.disablePlaygroundInProduction).toBe(true)
  })

  it('облікові колекції недоступні customer, гостю й manager (як у REST)', async () => {
    const queries: Array<[string, string, Who[]]> = [
      ['StockMoves', '{ StockMoves { docs { id } } }', ['guest', 'customer', 'manager']],
      ['ProductCosts', '{ ProductCosts { docs { id } } }', ['guest', 'customer', 'manager']],
      ['CashOperations', '{ CashOperations { docs { id } } }', ['guest', 'customer', 'manager']],
      ['SalarySchemes', '{ SalarySchemes { docs { id } } }', ['guest', 'customer', 'manager']],
      ['Suppliers', '{ Suppliers { docs { id } } }', ['guest', 'customer', 'manager']],
      ['PromoCodes', '{ PromoCodes { docs { id } } }', ['guest', 'customer', 'manager']],
      ['Payrolls', '{ Payrolls { docs { id } } }', ['guest', 'customer']],
      ['AccountingSetting', '{ AccountingSetting { stockControlEnabled } }', ['guest', 'customer', 'manager']],
    ]
    for (const [root, query, roles] of queries) {
      for (const who of roles) {
        const response = await ctx.gql(query, who)
        expect(forbidden(response, root), `${root} як ${who}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(true)
      }
    }
  })

  it('customer: замовлення лише свої, accounting і manager приховані (null), як у REST', async () => {
    const response = await ctx.gql('{ Orders { docs { id total accounting { cogsBani revenueBani } manager { id } source warehouse { id } } } }', 'customer')
    expect(response.status).toBe(200)
    const docs = response.body.data.Orders.docs
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.map((doc: { id: string }) => String(doc.id))).not.toContain(f.orderOther)
    for (const doc of docs) {
      expect(doc.accounting?.cogsBani ?? null).toBeNull()
      expect(doc.accounting?.revenueBani ?? null).toBeNull()
      expect(doc.manager).toBeNull()
      expect(doc.source ?? null).toBeNull()
      expect(doc.warehouse ?? null).toBeNull()
    }
  })

  it('manager: accounting у замовленнях null; клієнти без roles', async () => {
    const orders = await ctx.gql('{ Orders { docs { id accounting { cogsBani } } } }', 'manager')
    for (const doc of orders.body.data.Orders.docs) expect(doc.accounting?.cogsBani ?? null).toBeNull()
    const users = await ctx.gql('{ Users { docs { id roles } } }', 'manager')
    for (const doc of users.body.data.Users.docs) expect(doc.roles ?? null).toBeNull()
  })

  it('customer бачить у Users лише себе без roles і manager', async () => {
    const response = await ctx.gql('{ Users { docs { id roles manager { id } } } }', 'customer')
    expect(response.body.data.Users.docs.map((doc: { id: string }) => String(doc.id))).toEqual([String(ctx.actors.customer.id)])
    expect(response.body.data.Users.docs[0].roles ?? null).toBeNull()
  })

  it('гість: чернеток і оптової ціни немає', async () => {
    const response = await ctx.gql(`{ Products(where: { brand: { equals: "${f.brand}" } }, limit: 50) { docs { id title wholesalePrice } } }`, 'guest')
    const docs = response.body.data.Products.docs
    expect(docs.map((doc: { id: string }) => String(doc.id))).not.toContain(f.draft)
    for (const doc of docs) expect(doc.wholesalePrice ?? null).toBeNull()
  })

  it('мутації: customer не змінює й не видаляє замовлення, не створює склад', async () => {
    const update = await ctx.gql(`mutation { updateOrder(id: "${f.orderOwn}", data: { comment: "x" }) { id } }`, 'customer')
    expect(update.body.errors?.[0]?.extensions?.name).toBe('Forbidden')
    const del = await ctx.gql(`mutation { deleteOrder(id: "${f.orderOwn}") { id } }`, 'customer')
    expect(del.body.errors?.[0]?.extensions?.name).toBe('Forbidden')
    const create = await ctx.gql('mutation { createWarehouse(data: { name: "x", code: "x" }) { id } }', 'customer')
    expect(create.body.errors?.[0]?.extensions?.name).toBe('Forbidden')
    expect((await ctx.payload.findByID({ collection: 'orders', id: f.orderOwn, depth: 0, overrideAccess: true })).comment ?? null).toBeNull()
  })

  it('versions у graphQL: гість отримує відмову', async () => {
    const response = await ctx.gql('{ versionsProducts { totalDocs } }', 'guest')
    expect(response.body.errors?.[0]?.extensions?.name).toBe('Forbidden')
  })

  it('ескалація через graphQL: updateUser на себе не змінює roles і manager', async () => {
    const { customer } = ctx.actors
    await ctx.gql(`mutation { updateUser(id: "${customer.id}", data: { roles: [admin], manager: "${ctx.actors.manager.id}" }) { id } }`, 'customer')
    const saved = await ctx.payload.findByID({ collection: 'users', id: customer.id, depth: 0, overrideAccess: true })
    expect(saved.roles).toEqual(['customer'])
    expect(saved.manager ?? null).toBeNull()
  })

  it('обмеження складності запиту діє (дуже великий запит відхиляється)', async () => {
    const query = '{ ' + Array.from({ length: 1500 }, (_, i) => `a${i}: Products { totalDocs }`).join(' ') + ' }'
    const response = await ctx.gql(query, 'guest')
    expect(response.body.errors?.length ?? 0).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// K. Публічні відповіді й повідомлення про помилки
// ---------------------------------------------------------------------------

describe('K. публічні відповіді не розкривають внутрішніх даних', () => {
  const INTERNAL_KEYS = /^(qty|qtyDelta|valueBani|valueDeltaBani|avgCostBani|costBani|cogsBani|revenueBani|inventory|balance|stockBalance|available|warehouse|warehouses|accounting|stockPostedAt)$/i
  const LEAKY_TEXT = /node_modules|\.tsx?:\d+|\bat .+\(|stack|mongo|ObjectId|Cast to|E:\\|\/home\//i

  const publicProductPaths = () => [
    `/products/${f.pub}`,
    `/products/products-search?q=${tag}`,
    `/products/bestsellers`,
    `/products/products-brand/${fx.brandSlug}`,
    `/products/products-category/${fx.categorySlug}`,
  ]

  it('товарні ендпоінти віддають лише inStock (булеве), без qty, вартості й залишків — зі ввімкненим обліком', async () => {
    const before = await ctx.payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    try {
      await ctx.payload.updateGlobal({
        slug: 'accounting-settings',
        data: { stockControlEnabled: true, defaultWebWarehouse: f.warehouse } as never,
      })
      await stockUp(ctx.payload, f.pub, f.warehouse, 7, 70000)
      for (const path of publicProductPaths()) {
        for (const who of ['guest', 'customer'] as const) {
          const response = await ctx.http('GET', path, who)
          expect(response.status, path).toBe(200)
          const leaked = [...deepKeys(response.body)].filter((key) => INTERNAL_KEYS.test(key) && key !== 'inventory') // inventory: FINDING-12
          expect(leaked, `${path} як ${who}`).toEqual([])
        }
      }
      const single = await ctx.http('GET', `/products/${f.pub}`, 'guest')
      expect(single.body.inStock).toBe(true)
      expect(JSON.stringify(single.body)).not.toMatch(/"(7|70000)"/)
    } finally {
      await ctx.payload.updateGlobal({
        slug: 'accounting-settings',
        data: {
          stockControlEnabled: before.stockControlEnabled ?? false,
          defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
        } as never,
      })
    }
  })

  it('getFavorites і getBestSellers теж без внутрішніх полів', async () => {
    await ctx.http('POST', '/users/favorites', 'customer', { id: f.pub })
    const favorites = await ctx.http('GET', '/users/favorites', 'customer')
    expect([...deepKeys(favorites.body)].filter((key) => INTERNAL_KEYS.test(key))).toEqual([])
    await ctx.http('DELETE', `/users/favorites/${f.pub}`, 'customer')
  })

  it('повідомлення про помилки публічних ендпоінтів без id, шляхів і стеку', async () => {
    const address = { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' }
    const cases: Array<[string, string, unknown]> = [
      ['POST', '/orders/create', { items: [{ product: MISSING_ID, quantity: 1 }], shippingAddress: address }],
      ['POST', '/orders/create', { items: [{ product: { $ne: null }, quantity: 1 }], shippingAddress: address }],
      ['POST', '/orders/create', { items: [], shippingAddress: address }],
      ['POST', '/orders/create', { items: [{ product: f.pub, quantity: 1 }] }],
      ['GET', '/products/no-such-product-r3', undefined],
      ['POST', '/carts/promo', { promoCode: 'NO-SUCH' }],
      ['POST', '/carts/guest', { items: [] }],
      ['GET', `/orders/${MISSING_ID}`, undefined],
      ['GET', '/orders?where[accounting.cogsBani][greater_than]=0', undefined],
    ]
    for (const [method, path, body] of cases) {
      const response = await ctx.http(method, path, 'guest', body)
      expect(JSON.stringify(response.body), `${method} ${path}`).not.toMatch(LEAKY_TEXT)
      expect(response.status, `${method} ${path}`).toBeGreaterThanOrEqual(400)
    }
  })

  it('createOrder при нестачі: відповідь 409 має код і повідомлення (форма відповіді зафіксована; available див. FINDING-11)', async () => {
    const before = await ctx.payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    try {
      await ctx.payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: true, defaultWebWarehouse: f.warehouse } as never })
      const response = await ctx.http('POST', '/orders/create', 'guest', {
        items: [{ product: f.pub2, quantity: 5 }],
        shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
      })
      expect(response.status).toBe(409)
      expect(response.body.code).toBe('INSUFFICIENT_STOCK')
      expect(response.body.success).toBe(false)
      expect(JSON.stringify(response.body)).not.toMatch(LEAKY_TEXT)
    } finally {
      await ctx.payload.updateGlobal({
        slug: 'accounting-settings',
        data: {
          stockControlEnabled: before.stockControlEnabled ?? false,
          defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
        } as never,
      })
    }
  })
})

// ---------------------------------------------------------------------------
// M. Операційне: сиди, міграції, скрипти, секрети
// ---------------------------------------------------------------------------

describe('M. операційне: міграції, скрипти, секрети', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const read = (relative: string) => readFileSync(join(root, relative), 'utf8')
  const filesIn = (dir: string, ext = /\.tsx?$/): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? filesIn(join(dir, entry.name), ext) : ext.test(entry.name) ? [join(dir, entry.name)] : [],
    )

  it('міграції й скрипти не створюють користувачів зі стандартними паролями', () => {
    const files = [...filesIn('src/migrations'), ...filesIn('scripts')]
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((file) => {
      const text = read(file)
      return /collection:\s*['"]users['"]/.test(text) && /\bpassword\s*:/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('скрипти імпорту не підключені як ендпоінти і не імпортуються з src', () => {
    const importers = filesIn('src').filter((file) => /from\s+['"][^'"]*\bscripts\//.test(read(file)))
    expect(importers).toEqual([])
    for (const script of filesIn('scripts')) {
      expect(read(script), script).not.toMatch(/handler\s*:|export const \w+: Endpoint/)
    }
  })

  it('секрети й ключі не потрапляють у логи', () => {
    const logging = /(console\.\w+|logger\.\w+)\s*\(([^)]|\n)*?(SECRET|API_KEY|apiKey|PASSWORD|process\.env\.\w*(TOKEN|SECRET|KEY))/i
    const offenders = [...filesIn('src'), ...filesIn('scripts')].filter((file) => !file.includes('payload-types') && logging.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('PAYLOAD_SECRET використовується лише в payload.config.ts', () => {
    const users = filesIn('src').filter((file) => /PAYLOAD_SECRET/.test(read(file)))
    expect(users.map((file) => file.replace(/\\/g, '/'))).toEqual(['src/payload.config.ts'])
  })

  it('у відповідях API немає секретів автентифікації (login, me, список)', async () => {
    const user = await ctx.makeUser(['customer'])
    cleanups.push(() => ctx.payload.delete({ collection: 'users', id: user.id }))
    const login = await ctx.http('POST', '/users/login', 'guest', { email: user.email, password: PASSWORD })
    expect(login.status).toBe(200)
    const secrets = ['hash', 'salt', 'password', '_verificationToken', 'resetPasswordToken', 'resetPasswordExpiration', 'lockUntil', 'loginAttempts']
    expect(forbiddenKeysIn(login.body, secrets)).toEqual([])
    const adminList = await ctx.http('GET', '/users?limit=5', 'admin')
    expect(forbiddenKeysIn(adminList.body, secrets)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Знахідки. Кожен тест описує ПРАВИЛЬНУ поведінку й позначений it.fails: поки знахідка не виправлена,
// тест «падає» (і набір лишається зеленим); після виправлення він почне червоніти з повідомленням
// «Expect test to fail»: тоді замініть it.fails на it і приберіть рядок із таблиць у helpers/accessAuditTables.ts.
// ---------------------------------------------------------------------------

const tempUser = async (roles: Array<'admin' | 'manager' | 'customer'> = ['customer']) => {
  const user = await ctx.makeUser(roles)
  cleanups.push(async () => {
    await ctx.payload.delete({ collection: 'carts', where: { customer: { equals: user.id } } })
    await ctx.payload.delete({ collection: 'users', id: user.id })
  })
  return user
}

const lexicalText = {
  root: { type: 'root', format: '', indent: 0, version: 1, direction: null, children: [{ type: 'paragraph', format: '', indent: 0, version: 1, direction: null, children: [{ type: 'text', text: 'ok', format: 0, style: '', mode: 'normal', detail: 0, version: 1 }] }] },
}

const formBody = (emailTo: string) => ({
  title: `${tag} form`,
  fields: [],
  submitButtonLabel: 'Send',
  confirmationType: 'message',
  confirmationMessage: lexicalText,
  emails: [{ emailTo, emailFrom: 'noreply@nextlevelshop.md', subject: 'Audit', message: lexicalText }],
})

describe('[FINDING-1] wholesale і brandDiscounts задає сам клієнт', () => {
  it('реєстрація гостя не виставляє wholesale і brandDiscounts', async () => {
    const { doc } = await registerAsGuest({ wholesale: true, brandDiscounts: [{ brand: f.brand, discountPercent: 50 }] })
    expect(doc!.wholesale).toBe(false)
    expect(doc!.brandDiscounts ?? []).toEqual([])
  })

  it('customer не змінює свої wholesale і brandDiscounts через PATCH /users/:id', async () => {
    const user = await tempUser()
    await ctx.http('PATCH', `/users/${user.id}`, user, { wholesale: true, brandDiscounts: [{ brand: f.brand, discountPercent: 50 }] })
    const saved = await ctx.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })
    expect(saved.wholesale).toBe(false)
    expect(saved.brandDiscounts ?? []).toEqual([])
  })

  it('наслідок: замовлення клієнта, який сам себе зробив оптовиком, рахується за роздрібною ціною', async () => {
    const user = await tempUser()
    await ctx.http('PATCH', `/users/${user.id}`, user, { wholesale: true })
    const response = await ctx.http('POST', '/orders/create', user, {
      items: [{ product: f.pub, quantity: 1 }],
      shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
    })
    if (response.body?.order?.id) orderIds.push(String(response.body.order.id))
    const saved = await ctx.payload.findByID({ collection: 'orders', id: response.body.order.id, depth: 0, overrideAccess: true })
    expect(saved.total).toBe(100) // роздрібна ціна; з оптовою було б 80
  })
})

describe('[FINDING-2] customer змінює контент і каталог (дефолтний access)', () => {
  for (const slug of ['brands', 'categories', 'pages'] as const) {
    it.fails(`${slug}: customer не створює, не змінює й не видаляє`, async () => {
      const unique = `${tag}-${slug}-${Math.floor(Math.random() * 1e6)}`
      const target = await ctx.payload.create({ collection: slug, data: { title: unique, slug: unique } as never })
      cleanups.push(() => ctx.payload.delete({ collection: slug, id: target.id }))
      const created = await ctx.http('POST', `/${slug}`, 'customer', { title: `${unique}-new`, slug: `${unique}-new` })
      if (created.body?.doc?.id) await ctx.payload.delete({ collection: slug, id: created.body.doc.id }).catch(() => {})
      const updated = await ctx.http('PATCH', `/${slug}/${target.id}`, 'customer', { title: 'HACKED' })
      const removed = await ctx.http('DELETE', `/${slug}/${target.id}`, 'customer')
      expect([created.status, updated.status, removed.status]).toEqual([403, 403, 403])
    })

    it.fails(`${slug}: customer не видаляє масово за where`, async () => {
      const unique = `${tag}-del-${slug}-${Math.floor(Math.random() * 1e6)}`
      const target = await ctx.payload.create({ collection: slug, data: { title: unique, slug: unique } as never })
      cleanups.push(() => ctx.payload.delete({ collection: slug, id: target.id }))
      const response = await ctx.http('DELETE', `/${slug}?where[slug][equals]=${unique}`, 'customer')
      const alive = await ctx.payload.findByID({ collection: slug, id: target.id }).then(() => true).catch(() => false)
      expect([response.status, alive]).toEqual([403, true])
    })
  }

  for (const slug of ['posts', 'media'] as const) {
    it.fails(`${slug}: create, update, delete заборонені customer`, async () => {
      const created = await ctx.http('POST', `/${slug}`, 'customer', {})
      const updated = await ctx.http('PATCH', `/${slug}/${MISSING_ID}`, 'customer', {})
      const removed = await ctx.http('DELETE', `/${slug}/${MISSING_ID}`, 'customer')
      expect([created.status, updated.status, removed.status]).toEqual([403, 403, 403])
    })
  }
})


describe('[FINDING-3] form-submissions: будь-який авторизований читає й видаляє відправлення', () => {
  it.fails('customer не читає form-submissions', async () => {
    expect((await ctx.http('GET', '/form-submissions', 'customer')).status).toBe(403)
  })

  it.fails('customer не видаляє form-submissions', async () => {
    expect((await ctx.http('DELETE', `/form-submissions/${MISSING_ID}`, 'customer')).status).toBe(403)
  })

  it('гість і admin: гість не читає, admin читає (поточна поведінка)', async () => {
    expect((await ctx.http('GET', '/form-submissions', 'guest')).status).toBe(403)
    expect((await ctx.http('GET', '/form-submissions', 'admin')).status).toBe(200)
  })
})

describe('[FINDING-4] forms: customer створює форми, що розсилають листи', () => {
  it('контроль: форма, створена admin, розсилає лист на вказану адресу при відправленні гостем', async () => {
    const victim = `${tag}-victim@example.test`
    const created = await ctx.http('POST', '/forms', 'admin', formBody(victim))
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201)
    cleanups.push(() => ctx.payload.delete({ collection: 'forms', id: created.body.doc.id }))
    const send = vi.mocked(ctx.payload.sendEmail)
    send.mockClear()
    const submission = await ctx.http('POST', '/form-submissions', 'guest', { form: created.body.doc.id, submissionData: [] })
    expect(submission.status).toBe(201)
    cleanups.push(() => ctx.payload.delete({ collection: 'form-submissions', id: submission.body.doc.id }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(send.mock.calls.some(([message]) => JSON.stringify(message).includes(victim))).toBe(true)
  })

  it.fails('customer не створює форму з довільним списком розсилки', async () => {
    const response = await ctx.http('POST', '/forms', 'customer', formBody(`${tag}-victim2@example.test`))
    if (response.body?.doc?.id) cleanups.push(() => ctx.payload.delete({ collection: 'forms', id: response.body.doc.id }))
    expect(response.status).toBe(403)
  })

  it.fails('customer не змінює й не видаляє форми', async () => {
    const updated = await ctx.http('PATCH', `/forms/${MISSING_ID}`, 'customer', {})
    const removed = await ctx.http('DELETE', `/forms/${MISSING_ID}`, 'customer')
    expect([updated.status, removed.status]).toEqual([403, 403])
  })
})

describe('[FINDING-5] users.unlock: будь-який авторизований розблоковує чужі акаунти', () => {
  it.fails('customer не розблоковує чужий акаунт', async () => {
    const response = await ctx.http('POST', '/users/unlock', 'customer', { email: ctx.actors.customer2.email })
    expect(response.status).toBe(403)
  })

  it('гість не розблоковує акаунт (поточна поведінка)', async () => {
    expect((await ctx.http('POST', '/users/unlock', 'guest', { email: ctx.actors.customer2.email })).status).toBe(403)
  })
})

describe('[FINDING-6] carts: гість створює кошики, у тому числі для чужого customer', () => {
  it.fails('гість не створює кошик', async () => {
    const response = await ctx.http('POST', '/carts', 'guest', { items: [{ product: f.pub, quantity: 1 }], currency: 'MDL' })
    if (response.body?.doc?.id) cleanups.push(() => ctx.payload.delete({ collection: 'carts', id: response.body.doc.id }))
    expect(response.status).toBe(403)
  })

  it.fails('чужі товари не потрапляють у кошик жертви', async () => {
    const victim = await tempUser()
    const response = await ctx.http('POST', '/carts', 'guest', { customer: String(victim.id), items: [{ product: f.pub, quantity: 7 }], currency: 'MDL' })
    if (response.body?.doc?.id) cleanups.push(() => ctx.payload.delete({ collection: 'carts', id: response.body.doc.id }))
    const mine = await ctx.http('GET', '/carts/me', victim)
    expect(mine.body?.items?.length ?? 0).toBe(0)
  })

  it.fails('customer створює кошик лише для себе', async () => {
    const attacker = await tempUser()
    const victim = await tempUser()
    const response = await ctx.http('POST', '/carts', attacker, { customer: String(victim.id), items: [{ product: f.pub, quantity: 3 }], currency: 'MDL' })
    if (response.body?.doc?.id) cleanups.push(() => ctx.payload.delete({ collection: 'carts', id: response.body.doc.id }))
    const mine = await ctx.http('GET', '/carts/me', victim)
    expect(mine.body?.items?.length ?? 0).toBe(0)
  })
})

describe('[FINDING-7] sort за полями без права читання відкриває порядок значень (оракул)', () => {
  const orderOf = async (who: Who, ids: string[], sort: string) => {
    const response = await ctx.http('GET', `/orders?where[id][in]=${ids.join(',')}&sort=${sort}&limit=50`, who)
    return { status: response.status, ids: idList(response.body) }
  }

  const noOracle = (asc: { status: number; ids: string[] }, desc: { status: number; ids: string[] }) =>
    asc.status === 400 || desc.status === 400 || JSON.stringify(asc.ids) === JSON.stringify(desc.ids)

  it.fails('customer: сортування своїх замовлень за accounting.cogsBani не залежить від значень', async () => {
    const ids = [f.orderOwn, f.orderOwnLow]
    expect(noOracle(await orderOf('customer', ids, 'accounting.cogsBani'), await orderOf('customer', ids, '-accounting.cogsBani'))).toBe(true)
  })

  it.fails('manager: сортування замовлень за accounting.cogsBani не залежить від значень', async () => {
    const ids = [f.orderOwn, f.orderOwnLow, f.orderOther, f.orderOfManager2]
    expect(noOracle(await orderOf('manager', ids, 'accounting.cogsBani'), await orderOf('manager', ids, '-accounting.cogsBani'))).toBe(true)
  })

  it.fails('гість і customer: сортування товарів за wholesalePrice не залежить від значень', async () => {
    for (const who of ['guest', 'customer'] as const) {
      const run = async (sort: string) => {
        const response = await ctx.http('GET', `/products?where[id][in]=${f.pub},${f.pub2}&sort=${sort}`, who)
        return { status: response.status, ids: idList(response.body) }
      }
      expect(noOracle(await run('wholesalePrice'), await run('-wholesalePrice')), who).toBe(true)
    }
  })
})

describe('[FINDING-8] createOrder не перевіряє кількість (від’ємна, дробова)', () => {
  const place = async (items: Array<{ product: string; quantity: number }>) => {
    const response = await ctx.http('POST', '/orders/create', 'guest', {
      items, shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
    })
    if (response.body?.order?.id) orderIds.push(String(response.body.order.id))
    return response
  }

  it.fails('від’ємна кількість відхиляється', async () => {
    expect((await place([{ product: f.pub, quantity: -5 }])).status).toBe(400)
  })

  it.fails('дробова кількість відхиляється', async () => {
    expect((await place([{ product: f.pub, quantity: 0.5 }])).status).toBe(400)
  })

  it.fails('від’ємна позиція не «гасить» вартість іншої: замовлення з нульовою сумою не створюється', async () => {
    const response = await place([{ product: f.pub2, quantity: 1 }, { product: f.pub, quantity: -2 }])
    expect(response.status).toBe(400)
  })
})

describe('[FINDING-9] неопубліковані товари доступні публічно (обхід access через Local API)', () => {
  it.fails('GET /products/:id не віддає чернетку гостю', async () => {
    expect((await ctx.http('GET', `/products/${f.draft}`, 'guest')).status).toBe(404)
  })

  it.fails('каталог бренду не містить чернетки', async () => {
    const response = await ctx.http('GET', `/products/products-brand/${fx.brandSlug}`, 'guest')
    expect(response.body.products.map((product: { id: string }) => String(product.id))).not.toContain(f.draft)
  })

  it.fails('пошук не знаходить чернетку', async () => {
    const response = await ctx.http('GET', `/products/products-search?q=${encodeURIComponent('DRAFT-SECRET')}`, 'guest')
    expect(response.body.products.map((product: { id: string }) => String(product.id))).not.toContain(f.draft)
  })

  it.fails('гостьовий кошик не показує чернетку', async () => {
    const response = await ctx.http('POST', '/carts/guest', 'guest', { items: [{ productId: f.draft, quantity: 1 }] })
    expect(JSON.stringify(response.body)).not.toContain('DRAFT-SECRET')
  })

  it.fails('чернетку не можна замовити', async () => {
    const response = await ctx.http('POST', '/orders/create', 'guest', {
      items: [{ product: f.draft, quantity: 1 }],
      shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
    })
    if (response.body?.order?.id) orderIds.push(String(response.body.order.id))
    expect(response.status).toBeGreaterThanOrEqual(400)
  })

  it.fails('обране не віддає чернетку, id якої додано вручну', async () => {
    const user = await tempUser()
    await ctx.http('POST', '/users/favorites', user, { id: f.draft })
    const response = await ctx.http('GET', '/users/favorites', user)
    expect(JSON.stringify(response.body)).not.toContain('DRAFT-SECRET')
  })
})

describe('[FINDING-10] versions: будь-який авторизований читає історію товарів', () => {
  it.fails('customer не читає версії товару (чернетки, старі ціни)', async () => {
    const version = (await ctx.payload.findVersions({ collection: 'products', where: { parent: { equals: f.draft } }, overrideAccess: true })).docs[0]
    expect(version).toBeDefined()
    expect((await ctx.http('GET', `/products/versions/${version.id}`, 'customer')).status).toBe(403)
  })

  it.fails('customer не читає список версій через GraphQL', async () => {
    const response = await ctx.gql('{ versionsProducts { totalDocs } }', 'customer')
    expect(response.body.errors?.[0]?.extensions?.name).toBe('Forbidden')
  })
})

describe('[FINDING-11] 409 при нестачі віддає точний залишок будь-кому (питання власнику, В4)', () => {
  it.fails('відповідь 409 не містить available', async () => {
    const before = await ctx.payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    try {
      await ctx.payload.updateGlobal({ slug: 'accounting-settings', data: { stockControlEnabled: true, defaultWebWarehouse: f.warehouse } as never })
      await stockUp(ctx.payload, f.pub2, f.warehouse, 3, 3000)
      const response = await ctx.http('POST', '/orders/create', 'guest', {
        items: [{ product: f.pub2, quantity: 5 }],
        shippingAddress: { name: 'T', phone: '1', email: 'b@example.test', city: 'C', address: 'A' },
      })
      expect(response.status).toBe(409)
      expect(JSON.stringify(response.body)).not.toContain('available')
    } finally {
      await ctx.payload.updateGlobal({
        slug: 'accounting-settings',
        data: {
          stockControlEnabled: before.stockControlEnabled ?? false,
          defaultWebWarehouse: before.defaultWebWarehouse ? idOf(before.defaultWebWarehouse) : null,
        } as never,
      })
    }
  })
})

describe('[FINDING-12] каталог бренду й категорії віддає поле inventory', () => {
  it.fails('products-brand і products-category без inventory', async () => {
    for (const path of [`/products/products-brand/${fx.brandSlug}`, `/products/products-category/${fx.categorySlug}`]) {
      const response = await ctx.http('GET', path, 'guest')
      expect([...deepKeys(response.body)], path).not.toContain('inventory')
    }
  })
})

describe('[FINDING-13] гігієна облікових записів', () => {
  it.fails('зміна email клієнтом скидає верифікацію або вимагає підтвердження', async () => {
    const user = await tempUser()
    const response = await ctx.http('PATCH', `/users/${user.id}`, user, { email: `${tag}-changed-${Date.now()}@example.test` })
    const saved = (await ctx.payload.findByID({ collection: 'users', id: user.id, depth: 0, overrideAccess: true })) as Record<string, any>
    expect(response.status >= 400 || saved._verified === false).toBe(true)
  })

  it.fails('реєстрація не приймає службові поля автентифікації (resetPasswordToken, lockUntil, loginAttempts)', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const { doc } = await registerAsGuest({ resetPasswordToken: 'attacker-reset', resetPasswordExpiration: future, loginAttempts: 7, lockUntil: future })
    expect([doc!.resetPasswordToken ?? null, doc!.loginAttempts ?? 0, doc!.lockUntil ?? null]).toEqual([null, 0, null])
  })
})

describe('[FINDING-14] невідомий slug і службові шляхи дають 500 замість 404', () => {
  for (const path of ['/pages/no-such-page-r3', '/brands/no-such-brand-r3', '/posts/no-such-post-r3']) {
    it.fails('GET ' + path + ' → 404', async () => {
      expect((await ctx.http('GET', path, 'guest')).status).toBe(404)
    })
  }

  it.fails('GET /pages/versions і /orders/versions не дають 500', async () => {
    expect((await ctx.http('GET', '/pages/versions', 'guest')).status).toBeLessThan(500)
    expect((await ctx.http('GET', '/orders/versions', 'customer')).status).toBeLessThan(500)
  })
})

describe('[FINDING-15] ендпоінти плагіна seo не перевіряють автентифікацію', () => {
  for (const name of ['generate-title', 'generate-description', 'generate-url', 'generate-image']) {
    it.fails('POST /plugin-seo/' + name + ' для гостя → 401/403', async () => {
      const response = await ctx.http('POST', '/plugin-seo/' + name, 'guest', { doc: {}, collectionSlug: 'products' })
      expect([401, 403]).toContain(response.status)
    })
  }
})

describe('[FINDING-16] add-item читає тіло раніше, ніж перевіряє автентифікацію', () => {
  it.fails('гість з порожнім тілом отримує 401, а не 500', async () => {
    expect((await ctx.http('POST', '/carts/add-item', 'guest', {})).status).toBe(401)
  })
})

describe('[FINDING-17] кошики: відповідь розкриває існування чужого cartId', () => {
  it.fails('remove-item: чужий і неіснуючий cartId дають однакову відповідь', async () => {
    const owner = await tempUser()
    const other = await tempUser()
    const cart = await ctx.payload.create({ collection: 'carts', data: { customer: owner.id, items: [{ product: f.pub, quantity: 1 }], currency: 'MDL' } as never })
    cleanups.push(() => ctx.payload.delete({ collection: 'carts', id: cart.id }))
    const foreign = await ctx.http('POST', '/carts/remove-item', other, { cartId: String(cart.id), productId: f.pub })
    const missing = await ctx.http('POST', '/carts/remove-item', other, { cartId: MISSING_ID, productId: f.pub })
    expect([foreign.status, foreign.body]).toEqual([missing.status, missing.body])
  })
})

describe('[FINDING-18] graphQL увімкнено для внутрішніх облікових колекцій (рекомендація)', () => {
  it.fails('облікові колекції й глобал мають graphQL: false', () => {
    const internal = [
      'stock-moves', 'stock-balances', 'product-costs', 'purchases', 'stock-transfers', 'stock-adjustments', 'opening-balances',
      'cash-accounts', 'expense-categories', 'cash-moves', 'cash-operations', 'salary-schemes', 'payrolls', 'suppliers', 'warehouses',
      'promo-codes', 'transactions', 'accounting-settings',
    ]
    const enabled = inventoryEntities(ctx.payload.config)
      .filter((entity) => internal.includes(entity.slug) && entity.graphQL === 'on')
      .map((entity) => entity.slug)
    expect(enabled).toEqual([])
  })
})

describe('повнота знахідок', () => {
  it('поля з field-level access та hidden задокументовані інвентаризацією (не порожньо)', () => {
    const fields = inventoryFields(ctx.payload.config)
    expect(fields.some((field) => field.entity === 'orders' && field.path === 'accounting')).toBe(true)
    expect(fields.some((field) => field.entity === 'users' && field.path === 'roles')).toBe(true)
    expect(fields.some((field) => field.entity === 'products' && field.path === 'wholesalePrice')).toBe(true)
  })
})
