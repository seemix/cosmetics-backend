import { CollectionBeforeValidateHook } from 'payload'

export const resolveCartPrices: CollectionBeforeValidateHook = async ({
                                                            data,
                                                            req,
                                                          }) => {
  if (!data?.items?.length) return data
  // console.log('🔥 CART HOOK RUNS')
  console.log(req.user);

  const user = req.user
  // console.log(user)
  const isWholesale = Boolean(user?.wholesale)

  const items = await Promise.all(
    data.items.map(async (item: any) => {
      const product =
        typeof item.product === 'object'
          ? item.product
          : await req.payload.findByID({
            collection: 'products',
            id: item.product,
          })
      const price = isWholesale && product.wholesalePrice
        ? product.wholesalePrice
        : product.retailPrice

      return {
        ...item,
        price, // ⭐ ecommerce ПРИЙМАЄ ЦЕ ПОЛЕ
      }
    })
  )
 const obj = {...data, items};
 console.log(obj)
  return {
    ...data,
    items,
  }
}