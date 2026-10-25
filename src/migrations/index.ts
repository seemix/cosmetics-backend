import * as migration_20261024_074830_rename_promo_discount_percent from './20261024_074830_rename_promo_discount_percent';
import * as migration_20261025_100000_seed_warehouses from './20261025_100000_seed_warehouses';

export const migrations = [
  {
    up: migration_20261024_074830_rename_promo_discount_percent.up,
    down: migration_20261024_074830_rename_promo_discount_percent.down,
    name: '20261024_074830_rename_promo_discount_percent'
  },
  {
    up: migration_20261025_100000_seed_warehouses.up,
    down: migration_20261025_100000_seed_warehouses.down,
    name: '20261025_100000_seed_warehouses'
  },
];
