import {
  commitTransaction,
  createLocalReq,
  initTransaction,
  killTransaction,
  type Payload,
  type PayloadRequest,
} from 'payload'

import type { StockMove, User } from '@/payload-types'
import { issue, receive } from '@/services/stock/stockLedger.service'

import type { TestData } from './fixtures'

export type AuthUser = User & { collection: 'users' }

/** Виконує `fn` в окремій закоміченій транзакції, як це робить проведення документа. */
export const inTransaction = async <T>(
  payload: Payload,
  fn: (req: PayloadRequest) => Promise<T>,
): Promise<T> => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const result = await fn(req)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

/** Справжній користувач з роллю admin: `postedBy` / `reversedBy` зберігаються як зв'язок. */
export const createAdmin = async (payload: Payload, data: TestData): Promise<AuthUser> => {
  const user = await data.user()

  return {
    ...(await payload.update({ collection: 'users', id: user.id, data: { roles: ['admin'] } })),
    collection: 'users',
  } as AuthUser
}

export const costOf = async (payload: Payload, product: string) => {
  const doc = (
    await payload.find({ collection: 'product-costs', where: { product: { equals: product } }, depth: 0 })
  ).docs[0]

  return { qty: doc?.qty ?? 0, valueBani: doc?.valueBani ?? 0 }
}

export const qtyAt = async (payload: Payload, product: string, warehouse: string) =>
  (
    await payload.find({
      collection: 'stock-balances',
      where: { product: { equals: product }, warehouse: { equals: warehouse } },
      depth: 0,
    })
  ).docs[0]?.qty ?? 0

export const movesOfDoc = async (payload: Payload, collection: string, id: number | string): Promise<StockMove[]> =>
  (
    await payload.find({
      collection: 'stock-moves',
      where: { docCollection: { equals: collection }, docId: { equals: String(id) } },
      sort: 'createdAt',
      pagination: false,
      depth: 0,
    })
  ).docs

const fixtureDoc = { collection: 'test-docs', id: 'fixture' }

/** Початковий залишок напряму через сервіс, без документів. */
export const stockUp = (payload: Payload, product: string, warehouse: string, qty: number, valueBani: number) =>
  inTransaction(payload, (req) =>
    receive(req, { doc: fixtureDoc, moveType: 'opening', lines: [{ product, warehouse, qty, valueBani }] }),
  )

export const sellFrom = (payload: Payload, product: string, warehouse: string, qty: number) =>
  inTransaction(payload, (req) =>
    issue(req, { doc: fixtureDoc, moveType: 'sale', lines: [{ product, warehouse, qty }] }),
  )

/** Прибирає кеш і журнал тестових товарів та тестові склади. */
export const cleanupStock = async (payload: Payload, products: string[], warehouses: string[]) => {
  const byProduct = { product: { in: products } }
  await payload.delete({ collection: 'stock-moves', where: byProduct })
  await payload.delete({ collection: 'stock-balances', where: byProduct })
  await payload.delete({ collection: 'product-costs', where: byProduct })
  await payload.delete({ collection: 'warehouses', where: { id: { in: warehouses } } })
}

/** Проведені документи хук видалення не дає прибрати, тому тести чистять їх напряму в БД. */
export const deleteDocumentsDirectly = async (payload: Payload, slug: string, ids: Array<number | string>) => {
  const model = payload.db.collections[slug]

  await model.collection.deleteMany({
    _id: { $in: ids.map((id) => new model.base.Types.ObjectId(String(id))) },
  })
}
