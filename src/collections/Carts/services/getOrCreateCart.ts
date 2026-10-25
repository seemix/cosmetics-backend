import type { PayloadRequest } from 'payload'

export async function getOrCreateCart(
  req: PayloadRequest,
  userId: string,
): Promise<any> {
  const result = await req.payload.find({
    collection: 'carts',
    where: {
      customer: { equals: userId },
    },
    limit: 1,
    req,
  })

  if (result.docs[0]) {
    return result.docs[0]
  }

  return req.payload.create({
    collection: 'carts',
    data: {
      customer: userId,
      items: [],
      status: 'active',
    },
    req,
  })
}