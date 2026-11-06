import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import { AppError } from '../../core/errors/app-error.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import type {
  CategoryEntity,
  CreateSubscriptionInput,
  ListSubscriptionsFilter,
  SubscriptionEntity,
  TransactionKind,
  UpdateSubscriptionInput
} from './money.types.js';
import {
  assertMoneyAmount,
  effectiveMoneyAmount,
  moneyInputScale,
  assertMoneyCategory
} from './money.invariants.js';

interface CategoryDbRow {
  id: string;
  user_id: string;
  kind: 'expense' | 'income';
  name: string;
  icon: string | null;
  color: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

interface SubscriptionDbRow {
  id: string;
  user_id: string;
  name: string;
  amount: string;
  amount_scale: number | null;
  currency: string;
  billing_unit: 'week' | 'month' | 'year';
  billing_interval: number;
  anchor_date: string;
  next_billing_date: string;
  status: 'active' | 'paused' | 'cancelled';
  cancelled_on: string | null;
  category_id: string | null;
  reminder_days_before: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function invalidMoneyCursor(): never {
  throw AppError.validation([
    {
      field: 'cursor',
      code: 'INVALID_CURSOR',
      message: 'Supplied pagination cursor is malformed or invalid'
    }
  ]);
}

function decodeMoneyCursor(cursor: string, sort: 'date' | 'amount'): [string, string] {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) invalidMoneyCursor();
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return invalidMoneyCursor();
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
    return invalidMoneyCursor();
  }
  const parts = decoded.split('|');
  if (parts.length !== 2) return invalidMoneyCursor();
  const [sortValue, id] = parts;
  if (
    !sortValue ||
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return invalidMoneyCursor();
  }
  if (sort === 'amount') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(sortValue)) return invalidMoneyCursor();
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sortValue)) return invalidMoneyCursor();
    const parsedDate = new Date(`${sortValue}T00:00:00.000Z`);
    if (
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== sortValue
    ) {
      return invalidMoneyCursor();
    }
  }
  return [sortValue, id];
}

function formatDateOnly(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function toCategoryEntity(row: CategoryDbRow): CategoryEntity {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    name: row.name,
    icon: row.icon,
    color: row.color,
    archivedAt:
      row.archived_at instanceof Date
        ? row.archived_at
        : row.archived_at
          ? new Date(row.archived_at)
          : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    version: row.version
  };
}

function toSubscriptionEntity(row: SubscriptionDbRow): SubscriptionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: String(row.amount),
    amountScale: row.amount_scale,
    currency: row.currency,
    billingUnit: row.billing_unit,
    billingInterval: row.billing_interval,
    anchorDate: formatDateOnly(row.anchor_date)!,
    nextBillingDate: formatDateOnly(row.next_billing_date)!,
    status: row.status,
    cancelledOn: formatDateOnly(row.cancelled_on),
    categoryId: row.category_id,
    reminderDaysBefore: row.reminder_days_before,
    notes: row.notes,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    deletedAt:
      row.deleted_at instanceof Date
        ? row.deleted_at
        : row.deleted_at
          ? new Date(row.deleted_at)
          : null,
    version: row.version
  };
}

async function assertCreateCategory(
  trx: Kysely<DatabaseSchema>,
  userId: string,
  categoryId: string | null | undefined,
  kind: TransactionKind
): Promise<void> {
  if (!categoryId) return;
  const category = await trx
    .selectFrom('categories')
    .selectAll()
    .where('id', '=', categoryId)
    .where('user_id', '=', userId)
    .forShare()
    .executeTakeFirst();
  if (!category) throw AppError.notFound('Category not found');
  assertMoneyCategory(
    { id: category.id, kind: category.kind, archivedAt: category.archived_at },
    kind
  );
}

export class PgSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findCategoryById(userId: string, categoryId: string): Promise<CategoryEntity | null> {
    const row = (await this.db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', categoryId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as CategoryDbRow | undefined;

    return row ? toCategoryEntity(row) : null;
  }

  async createSubscription(
    userId: string,
    input: CreateSubscriptionInput
  ): Promise<SubscriptionEntity> {
    return this.db.transaction().execute(async (trx) => {
      await assertCreateCategory(trx, userId, input.categoryId, 'expense');
      const row = (await trx
        .insertInto('subscriptions')
        .values({
          user_id: userId,
          name: input.name,
          amount: input.amount,
          amount_scale: moneyInputScale(input.amount),
          currency: input.currency,
          billing_unit: input.billingUnit,
          billing_interval: input.billingInterval ?? 1,
          anchor_date: input.anchorDate,
          next_billing_date: input.nextBillingDate ?? input.anchorDate,
          category_id: input.categoryId ?? null,
          reminder_days_before: input.reminderDaysBefore ?? null,
          notes: input.notes ?? null,
          status: 'active'
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as SubscriptionDbRow;

      return toSubscriptionEntity(row);
    });
  }

  async findSubscriptionById(
    userId: string,
    subscriptionId: string
  ): Promise<SubscriptionEntity | null> {
    const row = (await this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('id', '=', subscriptionId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as SubscriptionDbRow | undefined;

    return row ? toSubscriptionEntity(row) : null;
  }

  async listSubscriptions(
    userId: string,
    filter: ListSubscriptionsFilter
  ): Promise<{ subscriptions: SubscriptionEntity[]; hasMore: boolean; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    let query = this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (filter.status) {
      query = query.where('status', '=', filter.status);
    }

    if (filter.cursor !== undefined) {
      const [cursorDate, cursorId] = decodeMoneyCursor(filter.cursor, 'date');
      query = query.where(
        sql<boolean>`(next_billing_date, id) > (${cursorDate}::date, ${cursorId}::uuid)`
      );
    }

    const rows = (await query
      .orderBy('next_billing_date', 'asc')
      .orderBy('id', 'asc')
      .limit(limit + 1)
      .execute()) as unknown as SubscriptionDbRow[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      const dateVal = formatDateOnly(last.next_billing_date) ?? '';
      nextCursor = Buffer.from(`${dateVal}|${last.id}`, 'utf8').toString('base64url');
    }

    return {
      subscriptions: items.map(toSubscriptionEntity),
      hasMore,
      nextCursor
    };
  }

  async updateSubscription(
    userId: string,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
    expectedVersion?: number | undefined
  ): Promise<SubscriptionEntity | null> {
    return this.db.transaction().execute(async (trx) => {
      const locked = (
        await sql<SubscriptionDbRow>`
        SELECT * FROM subscriptions WHERE id = ${subscriptionId}::uuid
        AND user_id = ${userId}::uuid AND deleted_at IS NULL FOR UPDATE
      `.execute(trx)
      ).rows[0];
      if (!locked) return null;
      assertMoneyAmount(
        effectiveMoneyAmount(input.amount, locked.amount, locked.amount_scale),
        input.currency ?? locked.currency,
        'amount'
      );
      const categoryId = input.categoryId !== undefined ? input.categoryId : locked.category_id;
      if (categoryId) {
        const category = await trx
          .selectFrom('categories')
          .selectAll()
          .where('id', '=', categoryId)
          .where('user_id', '=', userId)
          .forShare()
          .executeTakeFirst();
        if (!category) throw AppError.notFound('Category not found');
        assertMoneyCategory(
          { id: category.id, kind: category.kind, archivedAt: category.archived_at },
          'expense'
        );
      }
      let query = trx
        .updateTable('subscriptions')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.amount !== undefined
            ? { amount: input.amount, amount_scale: moneyInputScale(input.amount) }
            : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.billingUnit !== undefined ? { billing_unit: input.billingUnit } : {}),
          ...(input.billingInterval !== undefined
            ? { billing_interval: input.billingInterval }
            : {}),
          ...(input.anchorDate !== undefined ? { anchor_date: input.anchorDate } : {}),
          ...(input.nextBillingDate !== undefined
            ? { next_billing_date: input.nextBillingDate }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.cancelledOn !== undefined ? { cancelled_on: input.cancelledOn } : {}),
          ...(input.categoryId !== undefined ? { category_id: input.categoryId } : {}),
          ...(input.reminderDaysBefore !== undefined
            ? { reminder_days_before: input.reminderDaysBefore }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', subscriptionId)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null);

      if (expectedVersion !== undefined) {
        query = query.where('version', '=', expectedVersion);
      }

      const row = (await query.returningAll().executeTakeFirst()) as unknown as
        SubscriptionDbRow | undefined;
      return row ? toSubscriptionEntity(row) : null;
    });
  }

  async softDeleteSubscription(userId: string, subscriptionId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('subscriptions')
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', subscriptionId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async countActiveSubscriptions(userId: string): Promise<number> {
    const result = (await this.db
      .selectFrom('subscriptions')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as { count: number } | undefined;

    return result ? Number(result.count) : 0;
  }
}
