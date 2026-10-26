import { APIError, type PayloadRequest } from 'payload'

import type { CustomerMove } from '@/payload-types'
import { customT } from '@/i18n'
import { requireSession } from '@/services/stock/session'
import { formatMDL } from '@/utilities/money'

import { getCustomerDebts } from './debts.service'
import { changeOrderPaid } from './orderPayments.service'

/**
 * Баланс клієнта (docs/accounting/design.md, розд. 6.4). Гроші клієнта спершу йдуть на аванс
 * (`customer-balances.balanceBani`), а аванс одразу гасить борги його замовлень від найстарішого.
 * Аванс змінюється сирим умовним `$inc` у сесії транзакції `req`, `orders.paidBani` лише через
 * `changeOrderPaid`, кожна зміна пишеться в журнал `customer-moves`. Наприкінці кожної зміни кеш
 * боргу й сальдо клієнта (`debtBani`, `netBani`) перераховується повністю. Гостьові замовлення (без
 * клієнта) балансу не мають: їхня оплата йде прямо в замовлення, як і раніше.
 */

/** Документ, що спричинив рух. */
export type CustomerDocRef = { collection: string; id: string; number?: string }

type MoveArgs = { doc: CustomerDocRef; date: Date }
type MoveKind = CustomerMove['kind']

const balances = (req: PayloadRequest) => req.payload.db.collections['customer-balances'].collection

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) =>
  new req.payload.db.collections['customer-balances'].base.Types.ObjectId(id)

const assertAmount = (amountBani: number) => {
  if (!Number.isInteger(amountBani) || amountBani <= 0) {
    throw new Error(`Customer amount must be a positive whole number of bani, got ${amountBani}`)
  }
}

const customerName = async (req: PayloadRequest, customer: string) => {
  const user = await req.payload.findByID({ collection: 'users', id: customer, depth: 0, req }).catch(() => null)

  return [user?.name, user?.surname].filter(Boolean).join(' ') || user?.email || customer
}

/** Поточний аванс клієнта в сесії транзакції `req`; без документа балансу 0. */
export const getCustomerAdvanceBani = async (req: PayloadRequest, customer: string): Promise<number> => {
  const session = await requireSession(req)
  const doc = await balances(req).findOne<{ balanceBani?: number }>({ customer: toObjectId(req, customer) }, { session })

  return doc?.balanceBani ?? 0
}

/**
 * Кеш боргу й сальдо клієнта: `debtBani` = Σ боргів по його замовленнях, `netBani` = борг − аванс
 * (плюс = клієнт винен нам). Перераховується з замовлень, тож документ балансу з'являється й у
 * клієнта без оплат, щойно в нього є борг.
 */
export const refreshCustomerDebt = async (req: PayloadRequest, customer: string) => {
  const session = await requireSession(req)
  const debtBani = (await getCustomerDebts(req, { customer })).reduce((sum, debt) => sum + debt.debtBani, 0)
  const advance = { $ifNull: ['$balanceBani', 0] }
  const now = new Date()

  await balances(req).updateOne(
    { customer: toObjectId(req, customer) },
    [
      {
        $set: {
          balanceBani: advance,
          debtBani,
          netBani: { $subtract: [debtBani, advance] },
          updatedAt: now,
          createdAt: { $ifNull: ['$createdAt', now] },
        },
      },
    ],
    { session, upsert: true },
  )
}

/** Зміна авансу; зменшення лише умовним `$inc`, тож паралельні операції не уведуть його в мінус. */
const changeAdvance = async (req: PayloadRequest, customer: string, deltaBani: number) => {
  const session = await requireSession(req)
  const filter = { customer: toObjectId(req, customer) }
  const now = new Date()

  if (deltaBani > 0) {
    await balances(req).updateOne(
      filter,
      { $inc: { balanceBani: deltaBani }, $set: { updatedAt: now }, $setOnInsert: { createdAt: now } },
      { session, upsert: true },
    )
    return
  }

  const result = await balances(req).updateOne(
    { ...filter, balanceBani: { $gte: -deltaBani } },
    { $inc: { balanceBani: deltaBani }, $set: { updatedAt: now } },
    { session },
  )
  if (result.matchedCount > 0) return

  throw new APIError(
    customT(req.t)('custom:error:customerAdvanceInsufficient', {
      customer: await customerName(req, customer),
      requested: formatMDL(-deltaBani),
      available: formatMDL(await getCustomerAdvanceBani(req, customer)),
    }),
    409,
    undefined,
    true,
  )
}

type MoveData = { customer: string | null; kind: MoveKind; advanceDeltaBani?: number; order?: string; orderDeltaBani?: number }

const writeMove = (req: PayloadRequest, { doc, date }: MoveArgs, move: MoveData) =>
  req.payload.create({
    collection: 'customer-moves',
    data: {
      date: date.toISOString(),
      customer: move.customer,
      kind: move.kind,
      advanceDeltaBani: move.advanceDeltaBani ?? 0,
      order: move.order ?? null,
      orderDeltaBani: move.orderDeltaBani ?? 0,
      docCollection: doc.collection,
      docId: doc.id,
      docNumber: doc.number,
    },
    depth: 0,
    req,
  })

/**
 * Аванс гасить борги клієнта: спершу `first` (якщо в ньому є борг), далі від найстарішого
 * замовлення. `exclude` не отримує нічого (наприклад, замовлення, з якого гроші щойно повернулися).
 */
export const settleCustomer = async (
  req: PayloadRequest,
  { customer, first, exclude = [], ...args }: MoveArgs & { customer: string; first?: string | null; exclude?: string[] },
) => {
  let advance = await getCustomerAdvanceBani(req, customer)
  // Без авансу розподіляти нічого, але борг міг змінитися (нове замовлення, скасування).
  if (advance <= 0) return refreshCustomerDebt(req, customer)

  const rank = (orderId: string) => (orderId === first ? 0 : 1)
  const debts = (await getCustomerDebts(req, { customer }))
    .filter((debt) => !exclude.includes(debt.orderId))
    .sort(
      (a, b) =>
        rank(a.orderId) - rank(b.orderId) ||
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
        a.orderId.localeCompare(b.orderId),
    )

  for (const debt of debts) {
    if (advance <= 0) break

    const amountBani = Math.min(advance, debt.debtBani)
    if (amountBani <= 0) continue

    await changeAdvance(req, customer, -amountBani)
    await changeOrderPaid(req, { order: debt.orderId, deltaBani: amountBani })
    await writeMove(req, args, { customer, kind: 'allocation', advanceDeltaBani: -amountBani, order: debt.orderId, orderDeltaBani: amountBani })
    advance -= amountBani
  }

  await refreshCustomerDebt(req, customer)
}

/**
 * Гроші надходять клієнту (надходження, початковий аванс, сторно повернення): аванс зростає й
 * одразу гасить борги, спершу замовлення `first`.
 */
export const depositToCustomer = async (
  req: PayloadRequest,
  { customer, amountBani, kind, first, ...args }: MoveArgs & { customer: string; amountBani: number; kind: MoveKind; first?: string | null },
) => {
  assertAmount(amountBani)

  await changeAdvance(req, customer, amountBani)
  await writeMove(req, args, { customer, kind, advanceDeltaBani: amountBani })
  await settleCustomer(req, { customer, first, ...args })
}

/**
 * Гроші забираються в клієнта (сторно надходження чи початкового авансу): спершу з авансу, решта
 * знімається з оплат його замовлень від найновішого. Якщо грошей клієнта не вистачає (їх уже
 * повернули), помилка.
 */
export const withdrawFromCustomer = async (
  req: PayloadRequest,
  { customer, amountBani, ...args }: MoveArgs & { customer: string; amountBani: number },
) => {
  assertAmount(amountBani)

  const fromAdvance = Math.min(await getCustomerAdvanceBani(req, customer), amountBani)
  if (fromAdvance > 0) {
    await changeAdvance(req, customer, -fromAdvance)
    await writeMove(req, args, { customer, kind: 'reversal', advanceDeltaBani: -fromAdvance })
  }

  let rest = amountBani - fromAdvance
  if (rest > 0) {
    const session = await requireSession(req)
    const paidOrders = await req.payload.db.collections['orders'].collection
      .find<{ _id: { toString(): string }; paidBani?: number }>(
        { customer: toObjectId(req, customer), paidBani: { $gt: 0 } },
        { session, sort: { createdAt: -1, _id: -1 }, projection: { paidBani: 1 } },
      )
      .toArray()

    for (const order of paidOrders) {
      if (rest <= 0) break

      const amount = Math.min(order.paidBani ?? 0, rest)
      await changeOrderPaid(req, { order: String(order._id), deltaBani: -amount })
      await writeMove(req, args, { customer, kind: 'reversal', order: String(order._id), orderDeltaBani: -amount })
      rest -= amount
    }
  }

  if (rest > 0) {
    throw new APIError(
      customT(req.t)('custom:error:customerFundsInsufficient', {
        customer: await customerName(req, customer),
        requested: formatMDL(amountBani),
        available: formatMDL(amountBani - rest),
      }),
      409,
      undefined,
      true,
    )
  }

  await refreshCustomerDebt(req, customer)
}

/** Повернення клієнту з авансу (без замовлення): не більше за аванс. */
export const refundCustomerAdvance = async (
  req: PayloadRequest,
  { customer, amountBani, ...args }: MoveArgs & { customer: string; amountBani: number },
) => {
  assertAmount(amountBani)

  await changeAdvance(req, customer, -amountBani)
  await writeMove(req, args, { customer, kind: 'refund', advanceDeltaBani: -amountBani })
  await refreshCustomerDebt(req, customer)
}

/**
 * Зміна оплати конкретного замовлення поза авансом: гостьове замовлення й повернення по замовленню.
 * Правила (переплата, скасоване замовлення, сплачено не менше за суму) перевіряє `changeOrderPaid`.
 */
export const changeOrderPayment = async (
  req: PayloadRequest,
  { order, customer, deltaBani, kind, ...args }: MoveArgs & { order: string; customer: string | null; deltaBani: number; kind: MoveKind },
) => {
  await changeOrderPaid(req, { order, deltaBani })
  await writeMove(req, args, { customer, kind, order, orderDeltaBani: deltaBani })
  if (customer) await refreshCustomerDebt(req, customer)
}

/**
 * Сплачене замовлення клієнта більше не боргує (скасування, сторно customerDebt): уся оплата
 * повертається на аванс і гасить інші борги клієнта. `exclude` додатково не отримує нічого.
 */
export const releaseOrderPayment = async (
  req: PayloadRequest,
  { order, customer, exclude = [], ...args }: MoveArgs & { order: string; customer: string; exclude?: string[] },
) => {
  const session = await requireSession(req)
  const doc = await req.payload.db.collections['orders'].collection.findOne<{ paidBani?: number }>(
    { _id: toObjectId(req, order) },
    { session, projection: { paidBani: 1 } },
  )
  const paidBani = doc?.paidBani ?? 0
  // Неоплачене замовлення лише перестає боргувати.
  if (paidBani <= 0) return refreshCustomerDebt(req, customer)

  await changeOrderPaid(req, { order, deltaBani: -paidBani })
  await changeAdvance(req, customer, paidBani)
  await writeMove(req, args, { customer, kind: 'release', advanceDeltaBani: paidBani, order, orderDeltaBani: -paidBani })
  await settleCustomer(req, { customer, exclude: [order, ...exclude], ...args })
}
