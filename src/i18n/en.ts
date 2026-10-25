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
      ecommerce: 'Ecommerce',
      content: 'Content',
      users: 'Users',
    },
    validation: {
      integer: 'Value must be an integer',
      wholeBani: 'Amount must be a whole number of bani',
    },
    error: {
      periodLocked: 'The period is locked until {{date}}',
      insufficientStock: 'Insufficient stock: {{product}} in {{warehouse}}, requested {{requested}}, available {{available}}',
      postedOrderLocked: 'A posted order cannot be edited: items, total, discount and customer are frozen',
      cancelledIsFinal: 'A cancelled order cannot be reopened, create a new order instead',
      postedOrderDeleteForbidden: 'A posted order cannot be deleted, cancel it instead',
    },
    field: {
      title: 'Title',
      slug: 'Slug',
      logo: 'Logo',
      bigImage: 'Large image',
      description: 'Description',
      parentCategory: 'Parent category',
      alt: 'Alt text',
      caption: 'Caption',
      content: 'Content',
      slide: 'Slide',
      squareSlide: 'Square slide',
      customLink: 'Custom link',
      excerpt: 'Excerpt',
    },
    collection: {
      brands: {
        singular: 'Brand',
        plural: 'Brands',
      },
      categories: {
        singular: 'Category',
        plural: 'Categories',
      },
      media: {
        singular: 'Media',
        plural: 'Media',
      },
      pages: {
        singular: 'Page',
        plural: 'Pages',
      },
      posts: {
        singular: 'Post',
        plural: 'Posts',
      },
    },
  },
}
