import * as migration_20261024_074830_rename_promo_discount_percent from './20261024_074830_rename_promo_discount_percent';

export const migrations = [
  {
    up: migration_20261024_074830_rename_promo_discount_percent.up,
    down: migration_20261024_074830_rename_promo_discount_percent.down,
    name: '20261024_074830_rename_promo_discount_percent'
  },
];
