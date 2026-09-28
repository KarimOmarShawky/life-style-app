/**
 * src/features/money/money.repository.pg.ts
 *
 * Implements Section 4.3 & 6.7: PostgreSQL implementation of Money domain repository.
 */

import { sql, type Kysely } from 'kysely';
import { Decimal } from 'decimal.js';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { MoneyRepository, AuditLogData } from './money.repository.js';
import type {
  CategoryEntity,
  TransactionEntity,
  SubscriptionEntity,
  BudgetEntity,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateTransactionInput,
  UpdateTransactionInput,
  ListTransactionsFilter,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  ListSubscriptionsFilter,
  PaySubscriptionInput,
  CreateBudgetInput,
  UpdateBudgetInput,
  ReportFilter,
  ReportSummary,
  TransactionKind,
  BudgetPeriod
} from './money.types.js';
import { AppError } from '../../core/errors/app-error.js';

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

interface TransactionDbRow {
  id: string;
  user_id: string;
  kind: 'expense' | 'income';
  amount: string;
  currency: string;
  occurred_on: string;
  category_id: string | null;
  description: string | null;
  merchant: string | null;
  subscription_id: string | null;
  billing_date: string | null;
  source: 'manual';
  idempotency_key: string | null;
  idempotency_fingerprint: Buffer | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

interface SubscriptionDbRow {
  id: string;
  user_id: string;
  name: string;
  amount: string;
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

interface BudgetDbRow {
  id: string;
  user_id: string;
  category_id: string | null;
  amount_limit: string;
  currency: string;
  period: 'monthly';
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
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

function toTransactionEntity(row: TransactionDbRow): TransactionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    amount: String(row.amount),
    currency: row.currency,
    occurredOn: formatDateOnly(row.occurred_on)!,
    categoryId: row.category_id,
    description: row.description,
    merchant: row.merchant,
    subscriptionId: row.subscription_id,
    billingDate: formatDateOnly(row.billing_date),
    source: 'manual',
    idempotencyKey: row.idempotency_key,
    idempotencyFingerprint: row.idempotency_fingerprint,
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

function toSubscriptionEntity(row: SubscriptionDbRow): SubscriptionEntity {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    amount: String(row.amount),
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

function toBudgetEntity(row: BudgetDbRow): BudgetEntity {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    amountLimit: String(row.amount_limit),
    currency: row.currency,
    period: row.period,
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

async function insertAuditLogRow(
  dbOrTrx: Kysely<DatabaseSchema>,
  data: AuditLogData
): Promise<void> {
  await sql`
    INSERT INTO audit_logs (
      actor_type, actor_user_id, session_id, event_type, outcome,
      entity_type, entity_id, request_id, ip, user_agent, metadata
    ) VALUES (
      ${data.actorType},
      ${data.actorUserId ?? null},
      ${data.sessionId ?? null},
      ${data.eventType},
      ${data.outcome},
      ${data.entityType ?? null},
      ${data.entityId ?? null},
      ${data.requestId ?? null},
      ${data.ip ?? null},
      ${data.userAgent ? data.userAgent.slice(0, 300) : null},
      ${JSON.stringify(data.metadata ?? {})}::jsonb
    )
  `.execute(dbOrTrx);
}

export class PgMoneyRepository implements MoneyRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  // ==========================================
  // Categories
  // ==========================================

  async createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryEntity> {
    const row = (await this.db
      .insertInto('categories')
      .values({
        user_id: userId,
        kind: input.kind,
        name: input.name,
        icon: input.icon ?? null,
        color: input.color ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as CategoryDbRow;

    return toCategoryEntity(row);
  }

  async findCategoryById(userId: string, categoryId: string): Promise<CategoryEntity | null> {
    const row = (await this.db
      .selectFrom('categories')
      .selectAll()
      .where('id', '=', categoryId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as CategoryDbRow | undefined;

    return row ? toCategoryEntity(row) : null;
  }

  async findCategoryByName(
    userId: string,
    kind: TransactionKind,
    name: string
  ): Promise<CategoryEntity | null> {
    const row = (await this.db
      .selectFrom('categories')
      .selectAll()
      .where('user_id', '=', userId)
      .where('kind', '=', kind)
      .where(sql<boolean>`lower(name) = lower(${name.trim()})`)
      .where('archived_at', 'is', null)
      .executeTakeFirst()) as unknown as CategoryDbRow | undefined;

    return row ? toCategoryEntity(row) : null;
  }

  async listCategories(
    userId: string,
    kind?: TransactionKind | undefined,
    includeArchived?: boolean | undefined
  ): Promise<CategoryEntity[]> {
    let query = this.db.selectFrom('categories').selectAll().where('user_id', '=', userId);

    if (kind) {
      query = query.where('kind', '=', kind);
    }

    if (!includeArchived) {
      query = query.where('archived_at', 'is', null);
    }

    const rows = (await query.orderBy('name', 'asc').execute()) as unknown as CategoryDbRow[];

    return rows.map(toCategoryEntity);
  }

  async updateCategory(
    userId: string,
    categoryId: string,
    input: UpdateCategoryInput,
    expectedVersion?: number | undefined
  ): Promise<CategoryEntity | null> {
    let query = this.db
      .updateTable('categories')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.archived !== undefined
          ? { archived_at: input.archived ? new Date() : null }
          : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', categoryId)
      .where('user_id', '=', userId);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as
      CategoryDbRow | undefined;
    return row ? toCategoryEntity(row) : null;
  }

  async archiveCategory(userId: string, categoryId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('categories')
      .set({
        archived_at: new Date(),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', categoryId)
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async countActiveCategories(userId: string): Promise<number> {
    const result = (await this.db
      .selectFrom('categories')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .executeTakeFirst()) as { count: number } | undefined;

    return result ? Number(result.count) : 0;
  }

  // ==========================================
  // Transactions
  // ==========================================

  async createTransaction(
    userId: string,
    input: CreateTransactionInput,
    auditData: AuditLogData
  ): Promise<TransactionEntity> {
    return await this.db.transaction().execute(async (trx) => {
      const row = (await trx
        .insertInto('transactions')
        .values({
          user_id: userId,
          kind: input.kind,
          amount: input.amount,
          currency: input.currency,
          occurred_on: input.occurredOn,
          category_id: input.categoryId ?? null,
          description: input.description ?? null,
          merchant: input.merchant ?? null,
          subscription_id: input.subscriptionId ?? null,
          billing_date: input.billingDate ?? null,
          source: 'manual',
          idempotency_key: input.idempotencyKey,
          idempotency_fingerprint: input.idempotencyFingerprint
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as TransactionDbRow;

      await insertAuditLogRow(trx, {
        ...auditData,
        entityId: row.id,
        metadata: {
          ...auditData.metadata,
          amount: row.amount,
          currency: row.currency,
          kind: row.kind
        }
      });

      return toTransactionEntity(row);
    });
  }

  async findTransactionById(
    userId: string,
    transactionId: string
  ): Promise<TransactionEntity | null> {
    const row = (await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('id', '=', transactionId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as TransactionDbRow | undefined;

    return row ? toTransactionEntity(row) : null;
  }

  async findTransactionByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<TransactionEntity | null> {
    const row = (await this.db
      .selectFrom('transactions')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as TransactionDbRow | undefined;

    return row ? toTransactionEntity(row) : null;
  }

  async listTransactions(
    userId: string,
    filter: ListTransactionsFilter
  ): Promise<{ transactions: TransactionEntity[]; hasMore: boolean; nextCursor: string | null }> {
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    let query = this.db
      .selectFrom('transactions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (filter.kind) {
      query = query.where('kind', '=', filter.kind);
    }

    if (filter.categoryId) {
      query = query.where('category_id', '=', filter.categoryId);
    }

    if (filter.from) {
      query = query.where('occurred_on', '>=', filter.from);
    }

    if (filter.to) {
      query = query.where('occurred_on', '<=', filter.to);
    }

    if (filter.currency) {
      query = query.where('currency', '=', filter.currency);
    }

    if (filter.minAmount) {
      query = query.where('amount', '>=', filter.minAmount);
    }

    if (filter.maxAmount) {
      query = query.where('amount', '<=', filter.maxAmount);
    }

    // Cursor pagination parsing
    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64url').toString('utf8');
        const [cursorSortVal, cursorId] = decoded.split('|');
        if (cursorSortVal && cursorId) {
          if (filter.sort === 'amount') {
            query = query.where(
              sql<boolean>`(amount, id) < (${cursorSortVal}::numeric, ${cursorId}::uuid)`
            );
          } else {
            query = query.where(
              sql<boolean>`(occurred_on, id) < (${cursorSortVal}::date, ${cursorId}::uuid)`
            );
          }
        }
      } catch {
        // ignore malformed cursor
      }
    }

    if (filter.sort === 'amount') {
      query = query.orderBy('amount', 'desc').orderBy('id', 'desc');
    } else {
      query = query.orderBy('occurred_on', 'desc').orderBy('id', 'desc');
    }

    const rows = (await query.limit(limit + 1).execute()) as unknown as TransactionDbRow[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1]!;
      const sortVal =
        filter.sort === 'amount' ? String(last.amount) : String(last.occurred_on).slice(0, 10);
      nextCursor = Buffer.from(`${sortVal}|${last.id}`, 'utf8').toString('base64url');
    }

    return {
      transactions: items.map(toTransactionEntity),
      hasMore,
      nextCursor
    };
  }

  async updateTransaction(
    userId: string,
    transactionId: string,
    input: UpdateTransactionInput,
    auditData: AuditLogData,
    expectedVersion?: number | undefined
  ): Promise<TransactionEntity | null> {
    return await this.db.transaction().execute(async (trx) => {
      let query = trx
        .updateTable('transactions')
        .set({
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.occurredOn !== undefined ? { occurred_on: input.occurredOn } : {}),
          ...(input.categoryId !== undefined ? { category_id: input.categoryId } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', transactionId)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null);

      if (expectedVersion !== undefined) {
        query = query.where('version', '=', expectedVersion);
      }

      const row = (await query.returningAll().executeTakeFirst()) as unknown as
        TransactionDbRow | undefined;
      if (!row) {
        return null;
      }

      await insertAuditLogRow(trx, {
        ...auditData,
        entityId: row.id,
        metadata: {
          ...auditData.metadata,
          amount: row.amount,
          currency: row.currency,
          kind: row.kind
        }
      });

      return toTransactionEntity(row);
    });
  }

  async softDeleteTransaction(
    userId: string,
    transactionId: string,
    auditData: AuditLogData
  ): Promise<boolean> {
    return await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('transactions')
        .set({
          deleted_at: new Date(),
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', transactionId)
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();

      const numDeleted = Number(result.numUpdatedRows);
      if (numDeleted > 0) {
        await insertAuditLogRow(trx, {
          ...auditData,
          entityId: transactionId
        });
      }

      return numDeleted > 0;
    });
  }

  async countActiveTransactions(userId: string): Promise<number> {
    const result = (await this.db
      .selectFrom('transactions')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as { count: number } | undefined;

    return result ? Number(result.count) : 0;
  }

  // ==========================================
  // Subscriptions
  // ==========================================

  async createSubscription(
    userId: string,
    input: CreateSubscriptionInput
  ): Promise<SubscriptionEntity> {
    const row = (await this.db
      .insertInto('subscriptions')
      .values({
        user_id: userId,
        name: input.name,
        amount: input.amount,
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

    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64url').toString('utf8');
        const [cursorDate, cursorId] = decoded.split('|');
        if (cursorDate && cursorId) {
          query = query.where(
            sql<boolean>`(next_billing_date, id) > (${cursorDate}::date, ${cursorId}::uuid)`
          );
        }
      } catch {
        // ignore malformed cursor
      }
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
      const dateVal = String(last.next_billing_date).slice(0, 10);
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
    let query = this.db
      .updateTable('subscriptions')
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.billingUnit !== undefined ? { billing_unit: input.billingUnit } : {}),
        ...(input.billingInterval !== undefined ? { billing_interval: input.billingInterval } : {}),
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

  async paySubscription(
    userId: string,
    subscriptionId: string,
    input: PaySubscriptionInput,
    newNextBillingDate: string,
    auditEvents: { transactionAudit: AuditLogData; subscriptionAudit: AuditLogData }
  ): Promise<{ transaction: TransactionEntity; subscription: SubscriptionEntity }> {
    return await this.db.transaction().execute(async (trx) => {
      // 1. Lock subscription row
      const subRow = (
        await sql<SubscriptionDbRow>`
        SELECT * FROM subscriptions
        WHERE id = ${subscriptionId}::uuid AND user_id = ${userId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      `.execute(trx)
      ).rows[0];

      if (!subRow) {
        throw AppError.notFound('Subscription not found');
      }

      if (subRow.status !== 'active') {
        throw AppError.conflict('SUBSCRIPTION_NOT_ACTIVE', 'Subscription is not active');
      }

      const billingDate = formatDateOnly(subRow.next_billing_date)!;

      // 2. Check if already paid for this cycle
      const existingTx = (await trx
        .selectFrom('transactions')
        .selectAll()
        .where('subscription_id', '=', subscriptionId)
        .where('billing_date', '=', billingDate)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()) as unknown as TransactionDbRow | undefined;

      if (existingTx) {
        throw AppError.conflict(
          'ALREADY_PAID_FOR_PERIOD',
          `Subscription has already been paid for billing date ${billingDate}`
        );
      }

      // 3. Create linked expense transaction
      const txAmount = input.amount ?? subRow.amount;
      const occurredOn = input.occurredOn ?? billingDate;

      const txRow = (await trx
        .insertInto('transactions')
        .values({
          user_id: userId,
          kind: 'expense',
          amount: txAmount,
          currency: subRow.currency,
          occurred_on: occurredOn,
          category_id: subRow.category_id,
          description: subRow.name,
          subscription_id: subRow.id,
          billing_date: billingDate,
          source: 'manual',
          idempotency_key: input.idempotencyKey
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as TransactionDbRow;

      // 4. Advance nextBillingDate on subscription
      const updatedSubRow = (await trx
        .updateTable('subscriptions')
        .set({
          next_billing_date: newNextBillingDate,
          updated_at: new Date(),
          version: sql<number>`version + 1`
        })
        .where('id', '=', subscriptionId)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as SubscriptionDbRow;

      // 5. Append audit entries
      await insertAuditLogRow(trx, {
        ...auditEvents.transactionAudit,
        entityId: txRow.id,
        metadata: {
          ...auditEvents.transactionAudit.metadata,
          amount: txRow.amount,
          currency: txRow.currency,
          subscriptionId: subRow.id,
          billingDate
        }
      });

      await insertAuditLogRow(trx, {
        ...auditEvents.subscriptionAudit,
        entityId: subRow.id,
        metadata: {
          ...auditEvents.subscriptionAudit.metadata,
          previousBillingDate: billingDate,
          newNextBillingDate
        }
      });

      return {
        transaction: toTransactionEntity(txRow),
        subscription: toSubscriptionEntity(updatedSubRow)
      };
    });
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

  // ==========================================
  // Budgets
  // ==========================================

  async createBudget(userId: string, input: CreateBudgetInput): Promise<BudgetEntity> {
    const row = (await this.db
      .insertInto('budgets')
      .values({
        user_id: userId,
        category_id: input.categoryId ?? null,
        amount_limit: input.amountLimit,
        currency: input.currency,
        period: input.period ?? 'monthly'
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as BudgetDbRow;

    return toBudgetEntity(row);
  }

  async findBudgetById(userId: string, budgetId: string): Promise<BudgetEntity | null> {
    const row = (await this.db
      .selectFrom('budgets')
      .selectAll()
      .where('id', '=', budgetId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as BudgetDbRow | undefined;

    return row ? toBudgetEntity(row) : null;
  }

  async findActiveBudgetByTarget(
    userId: string,
    categoryId: string | null,
    currency: string,
    period: BudgetPeriod
  ): Promise<BudgetEntity | null> {
    let query = this.db
      .selectFrom('budgets')
      .selectAll()
      .where('user_id', '=', userId)
      .where('currency', '=', currency)
      .where('period', '=', period)
      .where('deleted_at', 'is', null);

    if (categoryId) {
      query = query.where('category_id', '=', categoryId);
    } else {
      query = query.where('category_id', 'is', null);
    }

    const row = (await query.executeTakeFirst()) as unknown as BudgetDbRow | undefined;
    return row ? toBudgetEntity(row) : null;
  }

  async listBudgets(userId: string): Promise<BudgetEntity[]> {
    const rows = (await this.db
      .selectFrom('budgets')
      .selectAll()
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at', 'asc')
      .execute()) as unknown as BudgetDbRow[];

    return rows.map(toBudgetEntity);
  }

  async updateBudget(
    userId: string,
    budgetId: string,
    input: UpdateBudgetInput,
    expectedVersion?: number | undefined
  ): Promise<BudgetEntity | null> {
    let query = this.db
      .updateTable('budgets')
      .set({
        ...(input.amountLimit !== undefined ? { amount_limit: input.amountLimit } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', budgetId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as
      BudgetDbRow | undefined;
    return row ? toBudgetEntity(row) : null;
  }

  async softDeleteBudget(userId: string, budgetId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('budgets')
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', budgetId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async calculateBudgetSpent(
    userId: string,
    categoryId: string | null,
    currency: string,
    periodStart: string,
    periodEnd: string
  ): Promise<string> {
    let result;
    if (categoryId) {
      result = await sql<{ total_spent: string }>`
        SELECT COALESCE(SUM(amount), 0)::text AS total_spent
        FROM transactions
        WHERE user_id = ${userId}::uuid
          AND kind = 'expense'
          AND currency = ${currency}
          AND occurred_on >= ${periodStart}::date
          AND occurred_on <= ${periodEnd}::date
          AND category_id = ${categoryId}::uuid
          AND deleted_at IS NULL
      `.execute(this.db);
    } else {
      // Overall budget sums ALL expense transactions
      result = await sql<{ total_spent: string }>`
        SELECT COALESCE(SUM(amount), 0)::text AS total_spent
        FROM transactions
        WHERE user_id = ${userId}::uuid
          AND kind = 'expense'
          AND currency = ${currency}
          AND occurred_on >= ${periodStart}::date
          AND occurred_on <= ${periodEnd}::date
          AND deleted_at IS NULL
      `.execute(this.db);
    }

    return result.rows[0]?.total_spent ?? '0.0000';
  }

  async countActiveBudgets(userId: string): Promise<number> {
    const result = (await this.db
      .selectFrom('budgets')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as { count: number } | undefined;

    return result ? Number(result.count) : 0;
  }

  // ==========================================
  // Reports
  // ==========================================

  async generateReportSummary(userId: string, filter: ReportFilter): Promise<ReportSummary> {
    const currency = filter.currency ?? 'USD';

    // 1. Totals (income, expense, net)
    const totalsRes = await sql<{ income: string; expense: string }>`
      SELECT 
        COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::text AS income,
        COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0)::text AS expense
      FROM transactions
      WHERE user_id = ${userId}::uuid
        AND currency = ${currency}
        AND occurred_on >= ${filter.from}::date
        AND occurred_on <= ${filter.to}::date
        AND deleted_at IS NULL
    `.execute(this.db);

    const income = totalsRes.rows[0]?.income ?? '0';
    const expense = totalsRes.rows[0]?.expense ?? '0';
    const net = new Decimal(income).minus(new Decimal(expense)).toString();

    // 2. By Category breakdown
    const catRows = (
      await sql<{
        category_id: string | null;
        name: string | null;
        kind: 'expense' | 'income';
        total: string;
        count: number | string;
      }>`
      SELECT 
        t.category_id,
        COALESCE(c.name, 'Uncategorized') AS name,
        t.kind,
        SUM(t.amount)::text AS total,
        COUNT(*)::int AS count
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ${userId}::uuid
        AND t.currency = ${currency}
        AND t.occurred_on >= ${filter.from}::date
        AND t.occurred_on <= ${filter.to}::date
        AND t.deleted_at IS NULL
      GROUP BY t.category_id, c.name, t.kind
      ORDER BY SUM(t.amount) DESC
    `.execute(this.db)
    ).rows;

    const byCategory = catRows.map((row) => {
      const totalDec = new Decimal(row.total);
      const denominator = row.kind === 'income' ? new Decimal(income) : new Decimal(expense);
      const share = denominator.greaterThan(0)
        ? Number(totalDec.dividedBy(denominator).times(100).toFixed(1))
        : 0;

      return {
        categoryId: row.category_id,
        name: row.name ?? 'Uncategorized',
        kind: row.kind,
        total: row.total,
        count: Number(row.count),
        share
      };
    });

    // 3. Time Series if groupBy !== 'none'
    let series;
    if (filter.groupBy && filter.groupBy !== 'none') {
      let truncUnit = 'day';
      if (filter.groupBy === 'week') truncUnit = 'week';
      if (filter.groupBy === 'month') truncUnit = 'month';

      const seriesRows = (
        await sql<{
          period_start: string;
          income: string;
          expense: string;
        }>`
        SELECT 
          date_trunc(${truncUnit}, occurred_on)::date::text AS period_start,
          COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::text AS income,
          COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0)::text AS expense
        FROM transactions
        WHERE user_id = ${userId}::uuid
          AND currency = ${currency}
          AND occurred_on >= ${filter.from}::date
          AND occurred_on <= ${filter.to}::date
          AND deleted_at IS NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `.execute(this.db)
      ).rows;

      series = seriesRows.map((r) => ({
        periodStart: r.period_start,
        income: r.income,
        expense: r.expense
      }));
    }

    return {
      currency,
      from: filter.from,
      to: filter.to,
      totals: {
        income,
        expense,
        net
      },
      byCategory,
      ...(series ? { series } : {})
    };
  }
}
