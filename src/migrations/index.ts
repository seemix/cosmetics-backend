import * as migration_20261024_074830_rename_promo_discount_percent from './20261024_074830_rename_promo_discount_percent';
import * as migration_20261025_100000_seed_warehouses from './20261025_100000_seed_warehouses';
import * as migration_20261026_100000_seed_cash_accounts from './20261026_100000_seed_cash_accounts';

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
  {
    up: migration_20261026_100000_seed_cash_accounts.up,
    down: migration_20261026_100000_seed_cash_accounts.down,
    name: '20261026_100000_seed_cash_accounts'
  },
];
