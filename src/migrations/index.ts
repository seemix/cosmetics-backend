import * as migration_20261024_074830_rename_promo_discount_percent from './20261024_074830_rename_promo_discount_percent';
import * as migration_20261025_100000_seed_warehouses from './20261025_100000_seed_warehouses';
import * as migration_20261026_100000_seed_cash_accounts from './20261026_100000_seed_cash_accounts';
import * as migration_20261027_100000_backfill_customer_moves from './20261027_100000_backfill_customer_moves';
import * as migration_20261027_110000_customer_balance_debts from './20261027_110000_customer_balance_debts';

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
  {
    up: migration_20261027_100000_backfill_customer_moves.up,
    down: migration_20261027_100000_backfill_customer_moves.down,
    name: '20261027_100000_backfill_customer_moves'
  },
  {
    up: migration_20261027_110000_customer_balance_debts.up,
    down: migration_20261027_110000_customer_balance_debts.down,
    name: '20261027_110000_customer_balance_debts'
  },
];
