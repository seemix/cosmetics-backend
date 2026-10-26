import { createLocalReq, type Endpoint, type Payload } from 'payload'
import { vi } from 'vitest'

import type { CashOperation, Order, Payroll, User } from '@/payload-types'
import { applyCashMoves } from '@/services/finance/cashLedger.service'
import { endOfDay, startOfDay } from '@/utilities/period'

import { TestData } from './fixtures'
import { silenceSideEffects } from './orderCall'
import { type AuthUser, cleanupStock, createAdmin, deleteDocumentsDirectly, inTransaction } from './stock'

/**
 * Сценарії для тестів звітів (R1). Звіти агрегують усю БД, а тести ділять одну БД, тому кожен файл
 * працює у власному випадковому дні в минулому: підміняється лише `Date` (`vi.setSystemTime`), і
 * документи проводяться саме тим часом, який задав тест. Так перевіряються абсолютні суми й межі дня.
 */

// Тіло JSON читається тестами вглиб; форма перевіряється очікуваннями, а не типом.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportBody = Record<string, any>

export type ReportCall = { status: number; cacheControl: string | null; body: ReportBody }

export type Caller = 'guest' | 'customer' | 'manager' | 'admin'

const fakeUser = (roles: User['roles']) => ({ id: 'report-user', roles, collection: 'users' }) as unknown as User

/** Прямий виклик обробника з параметрами рядка запиту, як це робить REST. */
export const callReport = async (
  payload: Payload,
  endpoint: Endpoint,
  query: Record<string, string | number | boolean | undefined>,
  user: Caller | AuthUser = 'admin',
): Promise<ReportCall> => {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) searchParams.set(key, String(value))

  const resolved = typeof user === 'string' ? (user === 'guest' ? undefined : fakeUser([user])) : user
  const req = await createLocalReq({ user: resolved as never, req: { searchParams } as never }, payload)
  const response = await endpoint.handler(req)

  return { status: response.status, cacheControl: response.headers.get('Cache-Control'), body: await response.json() }
}

/** Випадковий день 2001–2015 (поза даними інших тестів і попередніх запусків). */
export const randomDay = (): string => {
  const base = Date.UTC(2001, 0, 1)
  const span = Date.UTC(2015, 11, 31) - base
  const day = new Date(base + Math.floor(Math.random() * (span / 86_400_000)) * 86_400_000)

  return day.toISOString().slice(0, 10)
}

export const shiftDay = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/** Момент усередині дня `day` у поясі обліку: `hours` годин від його початку. */
export const at = (day: string, hours = 12) => new Date(startOfDay(day).getTime() + hours * 3_600_000)
export const firstMs = (day: string) => startOfDay(day)
export const lastMs = (day: string) => endOfDay(day)

/** Усі суми у відповіді цілі: обходить тіло й перевіряє кожне поле `*Bani`. */
export const nonIntegerBani = (node: unknown, path = ''): string[] => {
  if (Array.isArray(node)) return node.flatMap((item, index) => nonIntegerBani(item, `${path}[${index}]`))
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => {
      const where = path ? `${path}.${key}` : key
      if (/Bani$/.test(key) && !(typeof value === 'number' && Number.isInteger(value))) return [where]
      return nonIntegerBani(value, where)
    })
  }
  return []
}

type Line = { product: string; quantity: number; unitPriceBani: number }

/**
 * Документи через справжні колекції й хуки (проведення, сторно), з прибиранням після тесту.
 * Проведені документи хуки видалити не дають, тож вони видаляються напряму в БД.
 */
export class ReportScenario {
  readonly data: TestData
  admin!: AuthUser
  brand!: string
  warehouse!: string
  account!: string

  private readonly docs: Record<string, string[]> = {}
  private readonly products: string[] = []
  private readonly warehouses: string[] = []
  private previousSettings: Record<string, unknown> = {}
  private counter = 0

  constructor(
    readonly payload: Payload,
    readonly tag: string,
  ) {
    this.data = new TestData(payload)
  }

  private track(slug: string, id: string | number) {
    ;(this.docs[slug] ??= []).push(String(id))
    return String(id)
  }

  private get asAdmin() {
    return { user: this.admin, overrideAccess: false } as const
  }

  /** Облік увімкнено, склад замовлень з адмінки = тестовий склад, період не закрито. */
  async setup() {
    silenceSideEffects(this.payload)
    this.admin = await createAdmin(this.payload, this.data)
    this.brand = String((await this.data.brand()).id)
    this.warehouse = await this.newWarehouse('main')
    this.account = await this.newAccount('cash')

    const before = await this.payload.findGlobal({ slug: 'accounting-settings', depth: 0 })
    const idOf = (value: unknown) => (value && typeof value === 'object' ? (value as { id: string }).id : (value ?? null))
    this.previousSettings = {
      stockControlEnabled: before.stockControlEnabled ?? false,
      defaultAdminWarehouse: idOf(before.defaultAdminWarehouse),
      lockedUntil: before.lockedUntil ?? null,
      accountingStartAt: before.accountingStartAt ?? null,
    }
    await this.settings({ stockControlEnabled: true, defaultAdminWarehouse: this.warehouse, lockedUntil: null })
  }

  settings(patch: Record<string, unknown>) {
    return this.payload.updateGlobal({ slug: 'accounting-settings', data: patch as never })
  }

  /** Підмінює лише `Date`: таймери й драйвер MongoDB працюють як звичайно. */
  setNow(instant: Date) {
    if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instant)
  }

  realNow() {
    vi.useRealTimers()
  }

  async newWarehouse(code: string) {
    const doc = await this.payload.create({
      collection: 'warehouses',
      data: { name: `${this.tag} ${code}`, code: `${this.tag}-${code}` },
    })
    this.warehouses.push(String(doc.id))
    return String(doc.id)
  }

  async newAccount(code: string) {
    const doc = await this.payload.create({
      collection: 'cash-accounts',
      data: { name: `${this.tag} ${code}`, code: `${this.tag}-${code}`, kind: 'cash' },
    })
    return this.track('cash-accounts', doc.id)
  }

  async newProduct(retailPrice = 100, title?: string) {
    const doc = await this.data.product({ brand: this.brand, retailPrice })
    if (title) await this.payload.update({ collection: 'products', id: doc.id, data: { title } })
    this.products.push(String(doc.id))
    return String(doc.id)
  }

  async newSupplier(name = `supplier ${++this.counter}`) {
    const doc = await this.payload.create({ collection: 'suppliers', data: { name: `${this.tag} ${name}` } })
    return this.track('suppliers', doc.id)
  }

  async newCategory(code: string, isSalary = false) {
    const doc = await this.payload.create({
      collection: 'expense-categories',
      data: { name: `${this.tag} ${code}`, code: `${this.tag}-${code}`, isSalary },
    })
    return this.track('expense-categories', doc.id)
  }

  async newManager(name?: string) {
    const user = await this.data.user()
    await this.payload.update({ collection: 'users', id: user.id, data: { roles: ['manager'], ...(name ? { name } : {}) } })
    return String(user.id)
  }

  /** Клієнт (роль customer), за потреби закріплений за менеджером. */
  async newCustomer(manager?: string) {
    const user = await this.data.user()
    await this.payload.update({
      collection: 'users',
      id: user.id,
      data: { roles: ['customer'], ...(manager ? { manager } : {}) } as never,
    })
    return String(user.id)
  }

  /** Схема зарплати менеджера: оклад і відсоток від виручки за датою замовлення, знімок менеджера. */
  async scheme(
    manager: string,
    {
      fixedBani = 0,
      percentBp = 0,
      validFrom,
      validTo,
    }: { fixedBani?: number; percentBp?: number; validFrom: string; validTo: string },
  ) {
    const doc = await this.payload.create({
      collection: 'salary-schemes',
      data: {
        name: `${this.tag} scheme`,
        manager,
        fixedBani,
        percentBp,
        base: 'revenue',
        dateBasis: 'order_date',
        attribution: 'snapshot',
        validFrom,
        validTo,
      } as never,
      depth: 0,
    })
    return this.track('salary-schemes', doc.id)
  }

  /** Поповнення каси напряму через сервіс (лише `cash-moves`, без касових операцій). */
  fund(amountBani: number, account = this.account) {
    return inTransaction(this.payload, (req) =>
      applyCashMoves(req, { doc: { collection: 'test-docs', id: `${this.tag}-fund` }, lines: [{ account, deltaBani: amountBani }] }),
    )
  }

  private post(slug: 'purchases' | 'stock-adjustments' | 'cash-operations' | 'payrolls', id: string) {
    return this.payload.update({ collection: slug, id, data: { status: 'posted' }, ...this.asAdmin, depth: 0 })
  }

  reverse(slug: 'purchases' | 'stock-adjustments' | 'cash-operations' | 'payrolls', id: string) {
    return this.payload.update({
      collection: slug,
      id,
      data: { status: 'reversed', reversalReason: 'report test' },
      ...this.asAdmin,
      depth: 0,
    })
  }

  async purchase(
    supplier: string,
    lines: Line[],
    {
      extraCosts = [],
      post = true,
      warehouse = this.warehouse,
    }: { extraCosts?: Array<{ amountBani: number; payee: string }>; post?: boolean; warehouse?: string } = {},
  ) {
    const doc = await this.payload.create({
      collection: 'purchases',
      data: {
        status: 'draft',
        documentDate: new Date().toISOString(),
        supplier,
        warehouse,
        lines,
        extraCosts: extraCosts.map((cost) => ({ description: 'delivery', ...cost })),
      } as never,
      ...this.asAdmin,
      depth: 0,
    })
    const id = this.track('purchases', doc.id)
    return post ? this.post('purchases', id) : doc
  }

  async order(items: Array<{ product: string; quantity: number }>, { customer }: { customer?: string } = {}): Promise<Order> {
    const order = await this.payload.create({
      collection: 'orders',
      user: this.admin,
      data: { items: items.map((item) => ({ ...item, price: 0 })), total: 0, ...(customer ? { customer } : {}) } as never,
      depth: 0,
    })
    this.track('orders', order.id)
    return order
  }

  cancel(order: Order) {
    return this.payload.update({ collection: 'orders', id: order.id, user: this.admin, data: { status: 'cancelled' }, depth: 0 })
  }

  async adjustment(
    kind: 'writeoff' | 'inventory',
    lines: Array<{ product: string; quantity?: number; countedQty?: number; unitCostBani?: number }>,
    { post = true, warehouse = this.warehouse }: { post?: boolean; warehouse?: string } = {},
  ) {
    const doc = await this.payload.create({
      collection: 'stock-adjustments',
      data: {
        status: 'draft',
        documentDate: new Date().toISOString(),
        kind,
        warehouse,
        lines,
        ...(kind === 'writeoff' ? { reason: 'tester' } : {}),
      } as never,
      ...this.asAdmin,
      depth: 0,
    })
    const id = this.track('stock-adjustments', doc.id)
    return post ? this.post('stock-adjustments', id) : doc
  }

  async transfer(product: string, quantity: number, to: string) {
    const doc = await this.payload.create({
      collection: 'stock-transfers',
      data: {
        status: 'draft',
        documentDate: new Date().toISOString(),
        fromWarehouse: this.warehouse,
        toWarehouse: to,
        lines: [{ product, quantity }],
      } as never,
      ...this.asAdmin,
      depth: 0,
    })
    const id = this.track('stock-transfers', doc.id)
    return this.payload.update({ collection: 'stock-transfers', id, data: { status: 'posted' }, ...this.asAdmin, depth: 0 })
  }

  /** Касова операція з `operationDate` = зараз (підмінений час), проведена за замовчуванням. */
  async cash(
    fields: Partial<Omit<CashOperation, 'id' | 'createdAt' | 'updatedAt'>> & Pick<CashOperation, 'type' | 'amountBani'>,
    { post = true }: { post?: boolean } = {},
  ) {
    const doc = await this.payload.create({
      collection: 'cash-operations',
      data: { status: 'draft', operationDate: new Date().toISOString(), account: this.account, ...fields } as never,
      ...this.asAdmin,
      depth: 0,
    })
    const id = this.track('cash-operations', doc.id)
    return post ? this.post('cash-operations', id) : doc
  }

  async payroll(manager: string, periodFrom: string, periodTo: string, { post = true }: { post?: boolean } = {}): Promise<Payroll> {
    const doc = await this.payload.create({
      collection: 'payrolls',
      data: { status: 'draft', documentDate: new Date().toISOString(), manager, periodFrom, periodTo } as never,
      ...this.asAdmin,
      depth: 0,
    })
    const id = this.track('payrolls', doc.id)
    return post ? ((await this.post('payrolls', id)) as Payroll) : doc
  }

  /** Зареєструвати документ, створений поза сценарієм, для прибирання. */
  remember(slug: string, id: string | number) {
    return this.track(slug, id)
  }

  async cleanup() {
    this.realNow()
    await this.settings({ stockControlEnabled: this.previousSettings.stockControlEnabled === true })
    await this.settings(this.previousSettings).catch(() => {})

    const direct = ['orders', 'purchases', 'stock-adjustments', 'stock-transfers', 'cash-operations', 'payrolls', 'salary-schemes']
    for (const slug of direct) await deleteDocumentsDirectly(this.payload, slug, this.docs[slug] ?? [])

    const accounts = this.docs['cash-accounts'] ?? []
    await this.payload.delete({ collection: 'cash-moves', where: { account: { in: accounts } } })
    await this.payload.delete({ collection: 'cash-accounts', where: { id: { in: accounts } } })
    await this.payload.delete({ collection: 'expense-categories', where: { id: { in: this.docs['expense-categories'] ?? [] } } })
    await this.payload.delete({ collection: 'suppliers', where: { id: { in: this.docs.suppliers ?? [] } } })
    await cleanupStock(this.payload, this.products, this.warehouses)
    await this.data.cleanup()
  }
}
