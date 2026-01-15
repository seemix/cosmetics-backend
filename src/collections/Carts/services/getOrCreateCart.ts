export async function getOrCreateCart(
  payload: any,
  userId: string,
) {
  const result = await payload.find({
    collection: 'carts',
    where: {
      customer: { equals: userId },
    },
    limit: 1,
  })

  if (result.docs[0]) {
    return result.docs[0]
  }

  return payload.create({
    collection: 'carts',
    data: {
      customer: userId,
      items: [],
      status: 'active',
    },
  })
}