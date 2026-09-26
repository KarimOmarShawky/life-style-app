/**
 * Subscription persistence, and the derived renewal schedule.
 *
 * THE STORED RENEWAL DATE IS AN ANCHOR, NOT A DEADLINE. A subscription created
 * in January with a renewal date of the 15th still renews on the 15th in
 * September. The obvious implementation rolls the stored date forward every time
 * it passes, which needs a job that runs every day, and which is wrong in three
 * ways the moment the job misses a run: the date is stale, nothing notices, and
 * re-running the job double-counts.
 *
 * So the next billing date is COMPUTED from the anchor and today, on every read:
 *
 *   elapsed = whole months between the anchor and today
 *   periods = elapsed / step        (step is 1 for monthly, 12 for yearly)
 *   next    = anchor + periods * step months, rolled on one more if that is past
 *
 * Nothing is ever stale, because nothing is stored. An application left unopened
 * for a year reports the right date the moment it is opened.
 *
 * WHY THE INTERVAL IS ALWAYS ADDED TO THE ANCHOR, never to the previous result:
 * a subscription anchored on the 31st would otherwise land on the 28th in
 * February and stay there forever, because 28 + 1 month is 28. Adding N months
 * to the original date gives March the 31st back.
 *
 * Ownership is in the WHERE clause of every statement (DD-008).
 */
import { formatCalendarDate } from '@/core/utils/calendar-date';
import type { Cursor } from '@/core/utils/pagination';
import { query } from '@/infrastructure/database/postgres/pool';

import type {
  BillingCycle,
  CreateSubscriptionInput,
  SubscriptionCostRow,
  SubscriptionWithSchedule,
  UpdateSubscriptionInput,
} from './money.types';

interface SubscriptionRow {
  id: string;
  user_id: string;
  name: string;
  amount: string;
  currency: string;
  renewal_date: Date;
  billing_cycle: BillingCycle;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  next_renewal_date: Date | null;
  days_until_renewal: number | null;
}

function toSubscriptionRecord(row: SubscriptionRow): SubscriptionWithSchedule {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: row.amount,
    currency: row.currency,
    renewalDate: formatCalendarDate(row.renewal_date),
    billingCycle: row.billing_cycle,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRenewalDate: row.next_renewal_date ? formatCalendarDate(row.next_renewal_date) : null,
    daysUntilRenewal: row.days_until_renewal,
  };
}

/** Today is always `$2`, in every query in this file, so the fragments compose. */
const TODAY = '$2::date';

/**
 * The subscription table plus two lateral derivations: how many whole billing
 * periods have gone by, and the candidate date that many periods after the
 * anchor. `greatest(..., 0)` covers an anchor in the future, where the elapsed
 * count is negative and the answer is simply the anchor itself.
 */
const SCHEDULE_FROM = `
  FROM subscriptions s
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.billing_cycle = 'yearly' THEN 12 ELSE 1 END AS step,
           greatest(
             ((extract(year  FROM ${TODAY}) - extract(year  FROM s.renewal_date)) * 12
            + (extract(month FROM ${TODAY}) - extract(month FROM s.renewal_date)))::int,
             0) AS elapsed
  ) c
  CROSS JOIN LATERAL (
    SELECT (s.renewal_date + make_interval(months => (c.elapsed / c.step) * c.step))::date
             AS candidate
  ) d`;

/**
 * Null for an inactive subscription: a cancelled subscription has no next
 * billing date, and printing one would tell the user they are about to be
 * charged for something they stopped.
 */
const NEXT_RENEWAL = `
  CASE
    WHEN NOT s.is_active THEN NULL
    WHEN d.candidate >= ${TODAY} THEN d.candidate
    ELSE (s.renewal_date + make_interval(months => (c.elapsed / c.step + 1) * c.step))::date
  END AS next_renewal_date`;

const SCHEDULED_COLUMNS = `
  s.id, s.user_id, s.name, s.amount, s.currency, s.renewal_date, s.billing_cycle,
  s.is_active, s.created_at, s.updated_at,
  ${NEXT_RENEWAL}`;

/**
 * Wraps the derivation so `next_renewal_date` can be filtered and counted from,
 * which a SELECT list alias cannot be in the query that defines it.
 */
function scheduled(whereClause: string): string {
  return `
    SELECT x.*, (x.next_renewal_date - ${TODAY})::int AS days_until_renewal
      FROM (SELECT ${SCHEDULED_COLUMNS} ${SCHEDULE_FROM} ${whereClause}) x`;
}

export async function insertSubscription(
  userId: string,
  today: string,
  input: CreateSubscriptionInput,
): Promise<SubscriptionWithSchedule> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO subscriptions (user_id, name, amount, currency, renewal_date,
                                billing_cycle, is_active)
     VALUES ($1, $2, $3::numeric, coalesce($4, 'EGP'), $5::date,
             coalesce($6, 'monthly'), coalesce($7, TRUE))
     RETURNING id`,
    [
      userId,
      input.name,
      input.amount,
      input.currency ?? null,
      input.renewalDate,
      input.billingCycle ?? null,
      input.isActive ?? null,
    ],
  );

  const id = inserted.rows[0]?.id;
  if (id === undefined) {
    throw new Error('INSERT ... RETURNING produced no row');
  }

  const created = await findSubscriptionById(userId, today, id);
  if (!created) {
    throw new Error('subscription vanished immediately after insert');
  }
  return created;
}

export async function findSubscriptionById(
  userId: string,
  today: string,
  subscriptionId: string,
): Promise<SubscriptionWithSchedule | undefined> {
  const result = await query<SubscriptionRow>(scheduled(`WHERE s.user_id = $1 AND s.id = $3`), [
    userId,
    today,
    subscriptionId,
  ]);

  const row = result.rows[0];
  return row ? toSubscriptionRecord(row) : undefined;
}

/**
 * A page of subscriptions, newest first.
 *
 * Deliberately NOT ordered by the next renewal date, even though that is the
 * more interesting order. The derived date changes as today changes, so a cursor
 * issued yesterday would resume a differently ordered scan today and could skip
 * or repeat a row. `created_at` does not move. The "what renews soon" question
 * is answered exactly by `listUpcomingRenewals`, which is bounded and needs no
 * cursor.
 */
export async function listSubscriptions(
  userId: string,
  today: string,
  limit: number,
  cursor: Cursor | undefined,
  active: boolean | undefined,
): Promise<SubscriptionWithSchedule[]> {
  const shared = [userId, today, active ?? null];

  if (cursor) {
    const result = await query<SubscriptionRow>(
      `${scheduled(`WHERE s.user_id = $1
                      AND ($3::boolean IS NULL OR s.is_active = $3)
                      AND (s.created_at, s.id) < ($4, $5)`)}
       ORDER BY x.created_at DESC, x.id DESC
       LIMIT $6`,
      [...shared, cursor.createdAt, cursor.id, limit + 1],
    );
    return result.rows.map(toSubscriptionRecord);
  }

  const result = await query<SubscriptionRow>(
    `${scheduled(`WHERE s.user_id = $1 AND ($3::boolean IS NULL OR s.is_active = $3)`)}
     ORDER BY x.created_at DESC, x.id DESC
     LIMIT $4`,
    [...shared, limit + 1],
  );
  return result.rows.map(toSubscriptionRecord);
}

/**
 * Active subscriptions billing within `days`, soonest first.
 *
 * Inactive ones fall out without a predicate: their next renewal date is NULL,
 * and `NULL <= anything` is not true.
 */
export async function listUpcomingRenewals(
  userId: string,
  today: string,
  days: number,
  limit: number,
): Promise<SubscriptionWithSchedule[]> {
  const result = await query<SubscriptionRow>(
    `${scheduled(`WHERE s.user_id = $1`)}
     WHERE x.next_renewal_date <= ${TODAY} + $3::int
     ORDER BY x.next_renewal_date ASC, x.id ASC
     LIMIT $4`,
    [userId, today, days, limit],
  );
  return result.rows.map(toSubscriptionRecord);
}

export async function updateSubscription(
  userId: string,
  today: string,
  subscriptionId: string,
  input: UpdateSubscriptionInput,
): Promise<SubscriptionWithSchedule | undefined> {
  const result = await query<{ id: string }>(
    `UPDATE subscriptions s
        SET name          = CASE WHEN $3::boolean  THEN $4::text    ELSE s.name END,
            amount        = CASE WHEN $5::boolean  THEN $6::numeric ELSE s.amount END,
            currency      = CASE WHEN $7::boolean  THEN $8::text    ELSE s.currency END,
            renewal_date  = CASE WHEN $9::boolean  THEN $10::date   ELSE s.renewal_date END,
            billing_cycle = CASE WHEN $11::boolean THEN $12::text   ELSE s.billing_cycle END,
            is_active     = CASE WHEN $13::boolean THEN $14::boolean ELSE s.is_active END
      WHERE s.id = $1 AND s.user_id = $2
      RETURNING id`,
    [
      subscriptionId,
      userId,
      input.name !== undefined,
      input.name ?? null,
      input.amount !== undefined,
      input.amount ?? null,
      input.currency !== undefined,
      input.currency ?? null,
      input.renewalDate !== undefined,
      input.renewalDate ?? null,
      input.billingCycle !== undefined,
      input.billingCycle ?? null,
      input.isActive !== undefined,
      input.isActive ?? null,
    ],
  );

  if (result.rowCount === 0) {
    return undefined;
  }
  return findSubscriptionById(userId, today, subscriptionId);
}

export async function deleteSubscription(userId: string, subscriptionId: string): Promise<boolean> {
  const result = await query(`DELETE FROM subscriptions WHERE id = $1 AND user_id = $2`, [
    subscriptionId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

interface CostRow {
  currency: string;
  monthly_equivalent: string;
  monthly_total: string;
  yearly_total: string;
  entry_count: number;
}

/**
 * What the active subscriptions cost per month, per currency.
 *
 * A yearly subscription is divided by twelve, which does not always divide
 * exactly: 100.00 a year is 8.3333... a month. The division happens at full
 * NUMERIC precision and the ROUNDING HAPPENS ONCE, on the final sum, rather than
 * per row. Rounding each row first and then adding would drift by up to a cent
 * per subscription, which is exactly the accumulation this feature avoids
 * everywhere else.
 *
 * The raw monthly and yearly totals are returned alongside, unrounded, so a
 * client that wants to show real commitments rather than an average can.
 */
export async function subscriptionCosts(userId: string): Promise<SubscriptionCostRow[]> {
  const result = await query<CostRow>(
    `SELECT s.currency,
            round(sum(CASE WHEN s.billing_cycle = 'yearly'
                           THEN s.amount / 12 ELSE s.amount END), 2)::text
              AS monthly_equivalent,
            sum(CASE WHEN s.billing_cycle = 'monthly' THEN s.amount ELSE 0 END)::text
              AS monthly_total,
            sum(CASE WHEN s.billing_cycle = 'yearly'  THEN s.amount ELSE 0 END)::text
              AS yearly_total,
            count(*)::int AS entry_count
       FROM subscriptions s
      WHERE s.user_id = $1 AND s.is_active
      GROUP BY s.currency
      ORDER BY s.currency`,
    [userId],
  );

  return result.rows.map((row) => ({
    currency: row.currency,
    monthlyEquivalent: row.monthly_equivalent,
    monthlyTotal: row.monthly_total,
    yearlyTotal: row.yearly_total,
    count: row.entry_count,
  }));
}
