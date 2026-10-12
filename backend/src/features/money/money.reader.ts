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

export interface SubscriptionReaderItem {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
  billingUnit: string;
  nextBillingDate: string;
}

export interface MoneyReader {
  listSubscriptionsDueBetween(
    userId: string,
    from: string,
    to: string
  ): Promise<SubscriptionReaderItem[]>;
  countActiveSubscriptions(userId: string): Promise<number>;
}

function toMinor(amount: string | number): number {
  return Math.round(Number(amount) * 100);
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
      amountMinor: toMinor(row.amount as unknown as string),
      currency: row.currency,
      billingUnit: row.billing_unit,
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
