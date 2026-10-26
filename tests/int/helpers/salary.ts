import type { Payload } from 'payload'
import { expect } from 'vitest'

import { en, type CustomTranslationsKeys } from '@/i18n'

import type { TestData } from './fixtures'
import type { AuthUser } from './stock'

let counter = 0

/** Користувач з ролями; для клієнта можна одразу задати менеджера й ознаку оптовика. */
export const makeUser = async (
  payload: Payload,
  data: TestData,
  roles: Array<'admin' | 'manager' | 'customer'>,
  { wholesale = false, manager }: { wholesale?: boolean; manager?: string } = {},
): Promise<AuthUser> => {
  const user = await data.user({ wholesale })
  const updated = await payload.update({
    collection: 'users',
    id: user.id,
    data: { roles, _verified: true, ...(manager ? { manager } : {}) } as never,
  })

  return { ...updated, collection: 'users' } as AuthUser
}

export type RawOrder = {
  manager?: string | null
  customer?: string | null
  /** `null` = замовлення не проведене (склад не списано). */
  stockPostedAt?: Date | null
  revenueBani: number
  cogsBani?: number
  status?: string
  paymentState?: 'unpaid' | 'partial' | 'paid'
}

/**
 * Замовлення напряму в MongoDB, без хуків Orders: для розрахунку зарплати важливі лише облікові
 * поля, а точний `stockPostedAt` інакше не задати. Повертає id.
 */
export const insertOrder = async (payload: Payload, order: RawOrder): Promise<string> => {
  const model = payload.db.collections['orders']
  const objectId = (id: string | null | undefined) => (id ? new model.base.Types.ObjectId(id) : null)
  const now = new Date()
  const revenueBani = order.revenueBani

  const { insertedId } = await model.collection.insertOne({
    orderNumber: `SAL-${Date.now()}-${++counter}`,
    status: order.status ?? 'pending',
    total: revenueBani / 100,
    customer: objectId(order.customer),
    manager: objectId(order.manager),
    source: 'admin',
    items: [],
    paidBani: order.paymentState === 'paid' ? revenueBani : 0,
    paymentState: order.paymentState ?? 'unpaid',
    accounting: {
      stockPostedAt: order.stockPostedAt === undefined ? now : order.stockPostedAt,
      cogsBani: order.cogsBani ?? 0,
      revenueBani,
      cancelledAt: null,
    },
    createdAt: now,
    updatedAt: now,
  })

  return String(insertedId)
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Відмова саме з текстом ключа словника `custom:...` (Local API без мови працює англійською);
 * змінні `{{x}}` у тексті можуть бути будь-якими.
 */
export const rejectsWith = async (promise: Promise<unknown>, key: CustomTranslationsKeys) => {
  const template = key
    .split(':')
    .slice(1)
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en.custom)
  const pattern = new RegExp(`^${String(template).split(/\{\{\w+\}\}/).map(escapeRegExp).join('.*')}$`)

  await expect(promise).rejects.toThrow(pattern)
}
