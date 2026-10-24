import { Decimal } from 'decimal.js';
import { getCurrencyExponent } from './money.dto.js';
/**
 * src/features/money/money.reader.ts
 *
 * Read-only cross-feature interface for the money domain (feature-architecture
 * rule 2). Deliberately limited to subscription summaries — query features must
 * never expose transaction history (product decision: Money has no full
 * transaction list).
 */

import { type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import { formatDateOnly } from '../../core/time/date-utils.js';
import { literalContainsPattern } from '../../core/pagination/search-pattern.js';

export interface SubscriptionReaderItem {
  id: string;
  name: string;
  amountMinor: string;
  currencyExponent: number;
  currency: string;
  billingUnit: string;
  nextBillingDate: string;
}

export interface SubscriptionSearchItem {
  id: string;
  name: string;
  status: string;
  nextBillingDate: string;
}

export interface MoneyReader {
  listSubscriptionsDueBetween(
    userId: string,
    from: string,
    to: string
  ): Promise<SubscriptionReaderItem[]>;
  countActiveSubscriptions(userId: string): Promise<number>;
  /**
   * Owned subscription lookup for global search (F-07). Transaction rows are
   * deliberately NOT searchable: Money has no transaction-history surface, so
   * exposing them through search would create one.
   */
  searchSubscriptions(userId: string, q: string, limit: number): Promise<SubscriptionSearchItem[]>;
}

export function toMinor(amount: string, currency: string): string {
  return new Decimal(amount)
    .times(new Decimal(10).pow(getCurrencyExponent(currency)))
    .toFixed(0, Decimal.ROUND_HALF_UP);
}

export class PgMoneyReader implements MoneyReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async listSubscriptionsDueBetween(
    userId: string,
    from: string,
    to: string
  ): Promise<SubscriptionReaderItem[]> {
    const rows = await this.db
      .selectFrom('subscriptions')
      .select(['id', 'name', 'amount', 'currency', 'billing_unit', 'next_billing_date'])
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .where('deleted_at', 'is', null)
      .where('next_billing_date', '>=', from as never)
      .where('next_billing_date', '<=', to as never)
      .orderBy('next_billing_date', 'asc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      amountMinor: toMinor(String(row.amount), row.currency),
      currencyExponent: getCurrencyExponent(row.currency),
      currency: row.currency,
      billingUnit: row.billing_unit,
      nextBillingDate: formatDateOnly(row.next_billing_date)!
    }));
  }

  public async searchSubscriptions(
    userId: string,
    q: string,
    limit: number
  ): Promise<SubscriptionSearchItem[]> {
    const pattern = literalContainsPattern(q);
    const rows = await this.db
      .selectFrom('subscriptions')
      .select(['id', 'name', 'status', 'next_billing_date'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('name', 'ilike', pattern), eb('notes', 'ilike', pattern)]))
      .orderBy('name', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      nextBillingDate: formatDateOnly(row.next_billing_date)!
    }));
  }

  public async countActiveSubscriptions(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('subscriptions')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}
