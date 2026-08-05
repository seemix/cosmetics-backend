export const discountService = (price: number, discount: number = 0): number => {
  // Захист від некоректних або від'ємних значень
  const validPrice = Math.max(0, price);
  const validDiscount = Math.min(100, Math.max(0, discount));

  // Математична оптимізація та округлення до 2 знаків після коми
  const discountedPrice = validPrice * (1 - validDiscount / 100);

  return Math.round(discountedPrice * 100) / 100;
};