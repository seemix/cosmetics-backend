import type { CollectionBeforeValidateHook } from 'payload'

/**
 * MongoDB стартує транзакцію першою операцією в сесії. При створенні першими йдуть паралельні
 * запити валідації `filterOptions` (постачальник, склад), і другий із них падає з
 * `TransientTransactionError`. Один послідовний запит у сесії до валідації стартує транзакцію.
 */
export const startTransaction: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
  if (operation === 'create' && (await req.transactionID)) {
    await req.payload.count({ collection: 'purchases', where: { number: { equals: '' } }, req })
  }

  return data
}
