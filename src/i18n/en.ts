/**
 * Словник інтерфейсу адмінки, англійська: еталон структури для `ru` і `ro` (їх тип виводиться з цього файлу).
 * Простір `custom`; ключ у коді: `custom:status:draft`. Нові ключі додаються в усі три файли.
 */
export const en = {
  custom: {
    status: {
      draft: 'Draft',
      posted: 'Posted',
      reversed: 'Reversed',
    },
    term: {
      amount: 'Amount',
      comment: 'Comment',
      cost: 'Cost price',
      date: 'Date',
      kind: 'Type',
      number: 'Number',
      product: 'Product',
      quantity: 'Quantity',
      reason: 'Reason',
      reversalReason: 'Reversal reason',
      status: 'Status',
      supplier: 'Supplier',
      total: 'Total',
      unitPrice: 'Unit price',
      warehouse: 'Warehouse',
    },
    action: {
      post: 'Posting',
      reverse: 'Reversal',
    },
    period: {
      closed: 'Closed period',
    },
    group: {
      purchasing: 'Purchasing',
      stock: 'Stock',
    },
    validation: {
      integer: 'Value must be an integer',
      wholeBani: 'Amount must be a whole number of bani',
    },
  },
}
