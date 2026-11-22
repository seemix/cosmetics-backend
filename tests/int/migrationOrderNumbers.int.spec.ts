import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { up } from '@/migrations/20261122_200000_backfill_order_numbers'
import config from '@/payload.config'

let payload: Payload
const ids: Record<string, string> = {}
const tag = `MONUM-${Date.now()}`

const rawOrders = () => payload.db.collections.orders.collection
const oid = (id: string) => new payload.db.collections.orders.base.Types.ObjectId(id)

const runUp = async () => {
  const req = await createLocalReq({}, payload)
  await initTransaction(req)
  try {
    const session = payload.db.sessions?.[(await req.transactionID) as string]
    await up({ payload, req, session } as never)
    await commitTransaction(req)
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

const insert = async (key: string, createdAt: Date, orderNumber?: string | null) => {
  const { insertedId } = await rawOrders().insertOne({
    ...(orderNumber !== undefined ? { orderNumber } : {}),
    status: 'cancelled',
    source: 'admin',
    comment: tag,
    items: [],
    total: 0,
    createdAt,
    updatedAt: createdAt,
  })
  ids[key] = String(insertedId)
}

const numberOf = async (key: string) => (await rawOrders().findOne({ _id: oid(ids[key]) }))?.orderNumber as string | undefined

describe('номери для старих замовлень без номера', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    await insert('numbered', new Date(Date.UTC(2020, 0, 1)), `${tag}-kept`)
    await insert('newer', new Date(Date.UTC(2020, 0, 3)))
    await insert('older', new Date(Date.UTC(2020, 0, 2)))
  })

  afterAll(async () => {
    await rawOrders().deleteMany({ _id: { $in: Object.values(ids).map(oid) } })
  })

  it('видає послідовні номери від найстарішого й не чіпає наявні', async () => {
    await runUp()

    const older = await numberOf('older')
    const newer = await numberOf('newer')
    expect(older).toMatch(/^\d+$/)
    expect(newer).toMatch(/^\d+$/)
    expect(Number(newer)).toBeGreaterThan(Number(older))
    expect(await numberOf('numbered')).toBe(`${tag}-kept`)
  })

  it('повторний запуск нічого не змінює', async () => {
    const before = [await numberOf('older'), await numberOf('newer')]
    await runUp()
    expect([await numberOf('older'), await numberOf('newer')]).toEqual(before)
  })

  it('новий номер з лічильника більший за виданий міграцією', async () => {
    const order = await payload.create({
      collection: 'orders',
      data: { items: [], total: 0, status: 'cancelled', comment: tag } as never,
      overrideAccess: true,
    })
    ids.created = String(order.id)
    expect(Number(order.orderNumber)).toBeGreaterThan(Number(await numberOf('newer')))
  })
})
