type CartItemInput = {
  product: string;
  quantity: number;
};

type Cart = {
  items: CartItemInput[];
};
export function addOrUpdateCartItem(
  cart: Cart,
  item: CartItemInput,
): Cart {
  const { product, quantity } = item;

  const existingIndex = cart.items.findIndex(
    (i) =>
      i.product === product,
  );

  // 🆕 Якщо товару ще немає
  if (existingIndex === -1) {
    return {
      ...cart,
      items: [
        ...cart.items,
        {
          product,
          quantity,
        },
      ],
    };
  }

  // 🔁 Якщо товар вже є — оновлюємо кількість
  const updatedItems = cart.items.map((i, index) =>
    index === existingIndex
      ? { ...i, quantity }
      : i,
  );

  return {
    ...cart,
    items: updatedItems,
  };
}