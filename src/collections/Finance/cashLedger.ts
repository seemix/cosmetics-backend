import { APIError, type PayloadRequest } from 'payload'

import type { CashMove } from '@/payload-types'
import { customT } from '@/i18n'
import { requireSession } from '@/services/stock/session'
import { formatMDL } from '@/utilities/money'

/**
 * Єдине місце, що змінює `cash-accounts.balanceBani` (docs/accounting/design.md, розд. 6.1).
 * Кеш змінюється сирим умовним `$inc` у сесії транзакції `req`, журнал `cash-moves` пишеться
 * через Local API з `req`; будь-яка помилка відкочує обидва. Без відкритої транзакції сервіс не працює.
 */

/** Документ, що спричинив рух. */
export type CashDocRef = {
  collection: string
  id: string
  number?: string
}

export type CashLine = { account: string; deltaBani: number }

type BaseArgs = {
  doc: CashDocRef
  /** Дата руху, за замовчуванням зараз. */
  date?: Date
}

type AccountDoc = { balanceBani?: number; allowNegative?: boolean; name?: string }

const accounts = (req: PayloadRequest) => req.payload.db.collections['cash-accounts'].collection

// Зв'язки Payload зберігає як ObjectId, а сирі запити id не перетворюють.
const toObjectId = (req: PayloadRequest, id: string) =>
  new req.payload.db.collections['cash-accounts'].base.Types.ObjectId(id)

const idOf = (value: string | { id: string }) => (typeof value === 'object' ? value.id : value)

/** Стабільний порядок кас, щоб паралельні транзакції брали документи в однаковій черговості. */
const byAccount = <T extends { account: string }>(lines: T[]): T[] =>
  [...lines].sort((a, b) => a.account.localeCompare(b.account))

const assertDelta = (deltaBani: number) => {
  if (!Number.isInteger(deltaBani) || deltaBani === 0) {
    throw new Error(`Cash delta must be a non-zero whole number of bani, got ${deltaBani}`)
  }
}

/**
 * Зміна балансу каси. Витрата з каси з `allowNegative = false` проходить лише умовним `$inc`
 * (`balanceBani >= -delta`), тож паралельні операції не можуть увести баланс у мінус.
 */
const changeBalance = async (req: PayloadRequest, account: string, deltaBani: number, date: Date) => {
  const session = await requireSession(req)
  const _id = toObjectId(req, account)
  const update = { $inc: { balanceBani: deltaBani }, $set: { updatedAt: date } }

  const result = await accounts(req).updateOne(
    deltaBani < 0 ? { _id, $or: [{ allowNegative: true }, { balanceBani: { $gte: -deltaBani } }] } : { _id },
    update,
    { session },
  )
  if (result.matchedCount > 0) return

  const current = await accounts(req).findOne<AccountDoc>({ _id }, { session })
  if (!current) throw new Error(`Cash account ${account} not found`)

  throw new APIError(
    customT(req.t)('custom:error:insufficientCash', {
      account: current.name ?? account,
      requested: formatMDL(-deltaBani),
      available: formatMDL(current.balanceBani ?? 0),
    }),
    409,
    { code: 'INSUFFICIENT_CASH', account, requested: -deltaBani, available: current.balanceBani ?? 0 },
    true,
  )
}

type MoveData = { account: string; deltaBani: number; reversalOf?: string }

const writeMove = (req: PayloadRequest, doc: CashDocRef, date: Date, move: MoveData): Promise<CashMove> =>
  req.payload.create({
    collection: 'cash-moves',
    data: {
      ...move,
      date: date.toISOString(),
      docCollection: doc.collection,
      docId: doc.id,
      docNumber: doc.number,
    },
    depth: 0,
    req,
  })

/** Проведення: баланс кожної каси змінюється на `deltaBani` рядка, у журнал іде рух зі знаком. */
export const applyCashMoves = async (
  req: PayloadRequest,
  { doc, date = new Date(), lines }: BaseArgs & { lines: CashLine[] },
): Promise<CashMove[]> => {
  const sorted = byAccount(lines)
  sorted.forEach((line) => assertDelta(line.deltaBani))

  // Спершу витрати: нестача в касі не лишає частково проведених надходжень.
  const outgoingFirst = [...sorted].sort((a, b) => Number(a.deltaBani > 0) - Number(b.deltaBani > 0))
  for (const line of outgoingFirst) await changeBalance(req, line.account, line.deltaBani, date)

  const moves: CashMove[] = []
  for (const line of sorted) moves.push(await writeMove(req, doc, date, line))

  return moves
}

/**
 * Сторно: компенсуючі рухи з `reversalOf` і протилежною сумою. Повторне сторно заборонене.
 * Якщо повернення вимагає списання з каси, якої вже не вистачає, кидає помилку нестачі.
 */
export const revertCashMoves = async (
  req: PayloadRequest,
  { doc, date = new Date(), moves }: BaseArgs & { moves: CashMove[] },
): Promise<CashMove[]> => {
  const reverted = await req.payload.find({
    collection: 'cash-moves',
    where: { reversalOf: { in: moves.map((move) => move.id) } },
    pagination: false,
    depth: 0,
    req,
  })
  if (reverted.docs.length > 0) {
    throw new APIError(customT(req.t)('custom:error:cashMovesReverted'), 409, undefined, true)
  }

  const lines = moves.map((move) => ({ move, account: idOf(move.account), deltaBani: -move.deltaBani }))
  const outgoingFirst = [...byAccount(lines)].sort((a, b) => Number(a.deltaBani > 0) - Number(b.deltaBani > 0))
  for (const line of outgoingFirst) await changeBalance(req, line.account, line.deltaBani, date)

  const result: CashMove[] = []
  for (const { move, account, deltaBani } of lines) {
    result.push(await writeMove(req, doc, date, { account, deltaBani, reversalOf: move.id }))
  }

  return result
}
