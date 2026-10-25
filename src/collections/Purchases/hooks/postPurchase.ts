import type { DocumentTransitionArgs } from '@/services/documents/documentLifecycle'
import { receive, revert } from '@/services/stock/stockLedger.service'

type Relation = string | { id: string }
type LineData = { product: Relation; quantity: number; landedBani: number }

const idOf = (value: Relation) => (typeof value === 'object' ? value.id : value)

const docRef = ({ id, data, originalDoc }: DocumentTransitionArgs) => ({
  collection: 'purchases',
  id,
  number: String(data.number ?? originalDoc.number),
})

/** Проведення: прихід кожного рядка на склад накладної за посадочною вартістю (розд. 3.2). */
export const postPurchase = async (args: DocumentTransitionArgs) => {
  const { req, data, originalDoc, date } = args
  const lines = (data.lines ?? originalDoc.lines ?? []) as LineData[]
  const warehouse = idOf((data.warehouse ?? originalDoc.warehouse) as Relation)

  if (lines.length === 0) throw new Error('A purchase without lines cannot be posted')

  await receive(req, {
    doc: docRef(args),
    date,
    moveType: 'purchase',
    lines: lines.map((line) => ({
      product: idOf(line.product),
      warehouse,
      qty: line.quantity,
      valueBani: line.landedBani,
    })),
  })
}

/**
 * Сторно: компенсуючі рухи до рухів проведення. Залишок списується умовно (продано ⇒ помилка),
 * вартість зменшується на `landedBani`; `qty = 0 ⇒ value = 0`, від'ємна вартість блокується.
 */
export const reversePurchase = async (args: DocumentTransitionArgs) => {
  const { req, id, date } = args

  const { docs: moves } = await req.payload.find({
    collection: 'stock-moves',
    where: {
      docCollection: { equals: 'purchases' },
      docId: { equals: id },
      moveType: { equals: 'purchase' },
    },
    pagination: false,
    depth: 0,
    req,
  })

  await revert(req, { doc: docRef(args), date, moves })
}
