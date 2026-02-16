import type { CollectionBeforeChangeHook } from 'payload';

export const setOrderNumber: CollectionBeforeChangeHook = async ({ req, data, operation }) => {
  if (operation !== 'create') return data;

  const lastOrder = await req.payload.find({
    collection: 'orders',
    sort: '-createdAt',
    limit: 1,
  });

  let nextNumber = 1;

  if (lastOrder.docs.length) {
    const last = lastOrder?.docs[0]?.orderNumber;
    if (last) {
      nextNumber = Number(last) + 1;
    }
  }

  data.orderNumber = String(nextNumber).padStart(4, '1001');

  return data;
};