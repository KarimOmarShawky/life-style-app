/**
 * src/features/money/money.service.ts
 *
 * Implements Section 1.4.3–1.4.4, 6.7, 14.11 & AC-MON-01..07: Money Business Service.
 */

import crypto from 'node:crypto';
import { Decimal } from 'decimal.js';
import { AppError } from '../../core/errors/app-error.js';
import { getUserTodayDate, addDaysToDateString } from '../../core/time/date-utils.js';
import type { MoneyRepository } from './money.repository.js';
import type {
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
  BudgetUsage
} from './money.types.js';
import {
  toCategoryDto,
  toTransactionDto,
  toSubscriptionDto,
  toBudgetDto,
  toReportSummaryDto,
  type CategoryDto,
  type TransactionDto,
  type SubscriptionDto,
  type BudgetDto,
  type ReportSummaryDto
} from './money.dto.js';
import {
  calculateNextBillingDate,
  calculateInitialNextBillingDate,
  daysInMonth
} from './money.cycle.js';

export const MAX_CATEGORIES_PER_USER = 200;
export const MAX_TRANSACTIONS_PER_USER = 200000;
export const MAX_SUBSCRIPTIONS_PER_USER = 200;
export const MAX_BUDGETS_PER_USER = 100;

export interface RequestContext {
  requestId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export function computeTransactionFingerprint(input: {
  kind: string;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId?: string | null | undefined;
  description?: string | null | undefined;
  merchant?: string | null | undefined;
  subscriptionId?: string | null | undefined;
  billingDate?: string | null | undefined;
}): Buffer {
  const canonical = JSON.stringify({
    amount: input.amount,
    billingDate: input.billingDate ?? null,
    categoryId: input.categoryId ?? null,
    currency: input.currency,
    description: input.description ?? null,
    kind: input.kind,
    merchant: input.merchant ?? null,
    occurredOn: input.occurredOn,
    subscriptionId: input.subscriptionId ?? null
  });
  return crypto.createHash('sha256').update(canonical).digest();
}

function getUserToday(timezone: string): string {
  return getUserTodayDate(timezone);
}

export class MoneyService {
  constructor(private readonly moneyRepository: MoneyRepository) {}

  // ==========================================
  // Categories
  // ==========================================

  async createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryDto> {
    const activeCount = await this.moneyRepository.countActiveCategories(userId);
    if (activeCount >= MAX_CATEGORIES_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Categories quota exceeded (max ${MAX_CATEGORIES_PER_USER} active categories)`
      );
    }

    const existing = await this.moneyRepository.findCategoryByName(userId, input.kind, input.name);
    if (existing) {
      throw AppError.conflict(
        'CATEGORY_NAME_TAKEN',
        `Category name "${input.name}" is already taken for kind "${input.kind}"`
      );
    }

    const category = await this.moneyRepository.createCategory(userId, input);
    return toCategoryDto(category);
  }

  async getCategory(userId: string, categoryId: string): Promise<CategoryDto> {
    const category = await this.moneyRepository.findCategoryById(userId, categoryId);
    if (!category) {
      throw AppError.notFound('Category not found');
    }
    return toCategoryDto(category);
  }

  async listCategories(
    userId: string,
    kind?: 'expense' | 'income' | undefined,
    includeArchived?: boolean | undefined
  ): Promise<CategoryDto[]> {
    const categories = await this.moneyRepository.listCategories(userId, kind, includeArchived);
    return categories.map(toCategoryDto);
  }

  async updateCategory(
    userId: string,
    categoryId: string,
    input: UpdateCategoryInput
  ): Promise<CategoryDto> {
    const existing = await this.moneyRepository.findCategoryById(userId, categoryId);
    if (!existing) {
      throw AppError.notFound('Category not found');
    }

    if (input.name && input.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await this.moneyRepository.findCategoryByName(
        userId,
        existing.kind,
        input.name
      );
      if (duplicate && duplicate.id !== categoryId) {
        throw AppError.conflict(
          'CATEGORY_NAME_TAKEN',
          `Category name "${input.name}" is already taken for kind "${existing.kind}"`
        );
      }
    }

    const updated = await this.moneyRepository.updateCategory(
      userId,
      categoryId,
      input,
      input.version
    );

    if (!updated) {
      const checkExists = await this.moneyRepository.findCategoryById(userId, categoryId);
      if (checkExists) {
        throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Category was modified concurrently');
      }
      throw AppError.notFound('Category not found');
    }

    return toCategoryDto(updated);
  }

  async deleteCategory(userId: string, categoryId: string): Promise<void> {
    const existing = await this.moneyRepository.findCategoryById(userId, categoryId);
    if (!existing) {
      throw AppError.notFound('Category not found');
    }

    const archived = await this.moneyRepository.archiveCategory(userId, categoryId);
    if (!archived) {
      throw AppError.notFound('Category not found');
    }
  }

  // ==========================================
  // Transactions
  // ==========================================

  async createTransaction(
    userId: string,
    input: Omit<CreateTransactionInput, 'idempotencyFingerprint'>,
    context: RequestContext,
    userTimezone: string
  ): Promise<{ transaction: TransactionDto; isReplay: boolean }> {
    const fingerprint = computeTransactionFingerprint(input);

    // 1. Check idempotency reuse
    const existing = await this.moneyRepository.findTransactionByIdempotencyKey(
      userId,
      input.idempotencyKey
    );

    if (existing) {
      if (existing.idempotencyFingerprint && existing.idempotencyFingerprint.equals(fingerprint)) {
        return { transaction: toTransactionDto(existing), isReplay: true };
      }
      throw AppError.conflict(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency key has already been used with different request parameters'
      );
    }

    // 2. Check quota
    const activeCount = await this.moneyRepository.countActiveTransactions(userId);
    if (activeCount >= MAX_TRANSACTIONS_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Transactions quota exceeded (max ${MAX_TRANSACTIONS_PER_USER} active transactions)`
      );
    }

    // 3. Validate occurredOn <= userToday + 1 day
    const userToday = getUserTodayDate(userTimezone);
    const tomorrowDate = addDaysToDateString(userToday, 1);

    if (input.occurredOn > tomorrowDate) {
      throw AppError.validation([
        {
          field: 'occurredOn',
          message: 'occurredOn cannot be more than 1 day in the future'
        }
      ]);
    }

    // 4. Validate category
    if (input.categoryId) {
      const category = await this.moneyRepository.findCategoryById(userId, input.categoryId);
      if (!category) {
        throw AppError.notFound('Category not found');
      }
      if (category.kind !== input.kind) {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: `Category kind "${category.kind}" does not match transaction kind "${input.kind}"`
          }
        ]);
      }
      if (category.archivedAt !== null) {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Category is archived'
          }
        ]);
      }
    }

    // 5. Create transaction and write audit row in same DB transaction
    try {
      const tx = await this.moneyRepository.createTransaction(
        userId,
        {
          ...input,
          idempotencyFingerprint: fingerprint
        },
        {
          actorType: 'user',
          actorUserId: userId,
          eventType: 'transaction.created',
          outcome: 'success',
          entityType: 'transaction',
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent
        }
      );

      return { transaction: toTransactionDto(tx), isReplay: false };
    } catch (err: unknown) {
      const dbErr = err as { code?: string };
      // Race condition idempotency check
      if (dbErr.code === '23505') {
        const replayTx = await this.moneyRepository.findTransactionByIdempotencyKey(
          userId,
          input.idempotencyKey
        );
        if (
          replayTx &&
          replayTx.idempotencyFingerprint &&
          replayTx.idempotencyFingerprint.equals(fingerprint)
        ) {
          return { transaction: toTransactionDto(replayTx), isReplay: true };
        }
        throw AppError.conflict(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key has already been used with different request parameters'
        );
      }
      throw err;
    }
  }

  async getTransaction(userId: string, transactionId: string): Promise<TransactionDto> {
    const tx = await this.moneyRepository.findTransactionById(userId, transactionId);
    if (!tx) {
      throw AppError.notFound('Transaction not found');
    }
    return toTransactionDto(tx);
  }

  async listTransactions(
    userId: string,
    filter: ListTransactionsFilter
  ): Promise<{
    transactions: TransactionDto[];
    meta: { limit: number; hasMore: boolean; nextCursor: string | null };
  }> {
    const result = await this.moneyRepository.listTransactions(userId, filter);
    return {
      transactions: result.transactions.map(toTransactionDto),
      meta: {
        limit: filter.limit ?? 25,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      }
    };
  }

  async updateTransaction(
    userId: string,
    transactionId: string,
    input: UpdateTransactionInput,
    context: RequestContext
  ): Promise<TransactionDto> {
    const existing = await this.moneyRepository.findTransactionById(userId, transactionId);
    if (!existing) {
      throw AppError.notFound('Transaction not found');
    }

    const effectiveKind = input.kind ?? existing.kind;
    if (input.categoryId) {
      const category = await this.moneyRepository.findCategoryById(userId, input.categoryId);
      if (!category) {
        throw AppError.notFound('Category not found');
      }
      if (category.kind !== effectiveKind) {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: `Category kind "${category.kind}" does not match transaction kind "${effectiveKind}"`
          }
        ]);
      }
      if (category.archivedAt !== null) {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Category is archived'
          }
        ]);
      }
    }

    const updated = await this.moneyRepository.updateTransaction(
      userId,
      transactionId,
      input,
      {
        actorType: 'user',
        actorUserId: userId,
        eventType: 'transaction.updated',
        outcome: 'success',
        entityType: 'transaction',
        entityId: transactionId,
        requestId: context.requestId,
        ip: context.ip,
        userAgent: context.userAgent
      },
      input.version
    );

    if (!updated) {
      const checkExists = await this.moneyRepository.findTransactionById(userId, transactionId);
      if (checkExists) {
        throw AppError.conflict(
          'VERSION_CONFLICT',
          'Conflict: Transaction was modified concurrently'
        );
      }
      throw AppError.notFound('Transaction not found');
    }

    return toTransactionDto(updated);
  }

  async deleteTransaction(
    userId: string,
    transactionId: string,
    context: RequestContext
  ): Promise<void> {
    const existing = await this.moneyRepository.findTransactionById(userId, transactionId);
    if (!existing) {
      throw AppError.notFound('Transaction not found');
    }

    const deleted = await this.moneyRepository.softDeleteTransaction(userId, transactionId, {
      actorType: 'user',
      actorUserId: userId,
      eventType: 'transaction.deleted',
      outcome: 'success',
      entityType: 'transaction',
      entityId: transactionId,
      requestId: context.requestId,
      ip: context.ip,
      userAgent: context.userAgent
    });

    if (!deleted) {
      throw AppError.notFound('Transaction not found');
    }
  }

  // ==========================================
  // Subscriptions
  // ==========================================

  async createSubscription(
    userId: string,
    input: CreateSubscriptionInput,
    userTimezone: string
  ): Promise<SubscriptionDto> {
    const activeCount = await this.moneyRepository.countActiveSubscriptions(userId);
    if (activeCount >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Subscriptions quota exceeded (max ${MAX_SUBSCRIPTIONS_PER_USER} active subscriptions)`
      );
    }

    if (input.categoryId) {
      const category = await this.moneyRepository.findCategoryById(userId, input.categoryId);
      if (!category) {
        throw AppError.notFound('Category not found');
      }
      if (category.kind !== 'expense') {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Subscription category must be of kind "expense"'
          }
        ]);
      }
      if (category.archivedAt !== null) {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Category is archived'
          }
        ]);
      }
    }

    const userToday = getUserToday(userTimezone);
    const initialNextBilling =
      input.nextBillingDate ??
      calculateInitialNextBillingDate(
        input.anchorDate,
        userToday,
        input.billingUnit,
        input.billingInterval ?? 1
      );

    const sub = await this.moneyRepository.createSubscription(userId, {
      ...input,
      nextBillingDate: initialNextBilling
    });

    return toSubscriptionDto(sub, userToday);
  }

  async getSubscription(
    userId: string,
    subscriptionId: string,
    userTimezone: string
  ): Promise<SubscriptionDto> {
    const sub = await this.moneyRepository.findSubscriptionById(userId, subscriptionId);
    if (!sub) {
      throw AppError.notFound('Subscription not found');
    }
    const userToday = getUserToday(userTimezone);
    return toSubscriptionDto(sub, userToday);
  }

  async listSubscriptions(
    userId: string,
    filter: ListSubscriptionsFilter,
    userTimezone: string
  ): Promise<{
    subscriptions: SubscriptionDto[];
    meta: { limit: number; hasMore: boolean; nextCursor: string | null };
  }> {
    const userToday = getUserToday(userTimezone);
    const result = await this.moneyRepository.listSubscriptions(userId, filter);
    return {
      subscriptions: result.subscriptions.map((s) => toSubscriptionDto(s, userToday)),
      meta: {
        limit: filter.limit ?? 25,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
      }
    };
  }

  async updateSubscription(
    userId: string,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
    userTimezone: string
  ): Promise<SubscriptionDto> {
    const existing = await this.moneyRepository.findSubscriptionById(userId, subscriptionId);
    if (!existing) {
      throw AppError.notFound('Subscription not found');
    }

    if (input.categoryId) {
      const category = await this.moneyRepository.findCategoryById(userId, input.categoryId);
      if (!category) {
        throw AppError.notFound('Category not found');
      }
      if (category.kind !== 'expense') {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Subscription category must be of kind "expense"'
          }
        ]);
      }
    }

    const userToday = getUserToday(userTimezone);
    let cancelledOn = input.cancelledOn;
    if (
      input.status === 'cancelled' &&
      cancelledOn === undefined &&
      existing.cancelledOn === null
    ) {
      cancelledOn = userToday;
    } else if (input.status === 'active' || input.status === 'paused') {
      cancelledOn = null;
    }

    const updated = await this.moneyRepository.updateSubscription(
      userId,
      subscriptionId,
      {
        ...input,
        cancelledOn
      },
      input.version
    );

    if (!updated) {
      const checkExists = await this.moneyRepository.findSubscriptionById(userId, subscriptionId);
      if (checkExists) {
        throw AppError.conflict(
          'VERSION_CONFLICT',
          'Conflict: Subscription was modified concurrently'
        );
      }
      throw AppError.notFound('Subscription not found');
    }

    return toSubscriptionDto(updated, userToday);
  }

  async deleteSubscription(userId: string, subscriptionId: string): Promise<void> {
    const deleted = await this.moneyRepository.softDeleteSubscription(userId, subscriptionId);
    if (!deleted) {
      throw AppError.notFound('Subscription not found');
    }
  }

  async paySubscription(
    userId: string,
    subscriptionId: string,
    input: PaySubscriptionInput,
    context: RequestContext,
    userTimezone: string
  ): Promise<{ transaction: TransactionDto; subscription: SubscriptionDto }> {
    const sub = await this.moneyRepository.findSubscriptionById(userId, subscriptionId);
    if (!sub) {
      throw AppError.notFound('Subscription not found');
    }

    if (sub.status !== 'active') {
      throw AppError.conflict('SUBSCRIPTION_NOT_ACTIVE', 'Subscription is not active');
    }

    const newNextBillingDate = calculateNextBillingDate(
      sub.anchorDate,
      sub.nextBillingDate,
      sub.billingUnit,
      sub.billingInterval
    );

    const userToday = getUserToday(userTimezone);

    const result = await this.moneyRepository.paySubscription(
      userId,
      subscriptionId,
      input,
      newNextBillingDate,
      {
        transactionAudit: {
          actorType: 'user',
          actorUserId: userId,
          eventType: 'transaction.created',
          outcome: 'success',
          entityType: 'transaction',
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent
        },
        subscriptionAudit: {
          actorType: 'user',
          actorUserId: userId,
          eventType: 'subscription.paid',
          outcome: 'success',
          entityType: 'subscription',
          requestId: context.requestId,
          ip: context.ip,
          userAgent: context.userAgent
        }
      }
    );

    return {
      transaction: toTransactionDto(result.transaction),
      subscription: toSubscriptionDto(result.subscription, userToday)
    };
  }

  // ==========================================
  // Budgets
  // ==========================================

  private async computeBudgetUsage(
    userId: string,
    categoryId: string | null,
    currency: string,
    amountLimitStr: string,
    userTimezone: string
  ): Promise<BudgetUsage> {
    const userToday = getUserTodayDate(userTimezone);
    const parts = userToday.split('-').map(Number);
    const year = parts[0] ?? 2026;
    const month = parts[1] ?? 1;
    const lastDay = daysInMonth(year, month);

    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const spent = await this.moneyRepository.calculateBudgetSpent(
      userId,
      categoryId,
      currency,
      periodStart,
      periodEnd
    );

    const limitDec = new Decimal(amountLimitStr);
    const spentDec = new Decimal(spent);
    const remainingDec = limitDec.minus(spentDec);
    const percentUsed = limitDec.greaterThan(0)
      ? Number(spentDec.dividedBy(limitDec).times(100).toFixed(1))
      : 0;
    const overspent = spentDec.greaterThan(limitDec);

    return {
      periodStart,
      periodEnd,
      spent,
      remaining: remainingDec.toString(),
      percentUsed,
      overspent
    };
  }

  async createBudget(
    userId: string,
    input: CreateBudgetInput,
    userTimezone: string
  ): Promise<BudgetDto> {
    const activeCount = await this.moneyRepository.countActiveBudgets(userId);
    if (activeCount >= MAX_BUDGETS_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Budgets quota exceeded (max ${MAX_BUDGETS_PER_USER} active budgets)`
      );
    }

    if (input.categoryId) {
      const category = await this.moneyRepository.findCategoryById(userId, input.categoryId);
      if (!category) {
        throw AppError.notFound('Category not found');
      }
      if (category.kind !== 'expense') {
        throw AppError.validation([
          {
            field: 'categoryId',
            message: 'Budget category must be of kind "expense"'
          }
        ]);
      }
    }

    const existing = await this.moneyRepository.findActiveBudgetByTarget(
      userId,
      input.categoryId ?? null,
      input.currency,
      input.period ?? 'monthly'
    );

    if (existing) {
      throw AppError.conflict(
        'BUDGET_ALREADY_EXISTS',
        'An active budget already exists for this category/currency combination'
      );
    }

    const budget = await this.moneyRepository.createBudget(userId, input);
    const usage = await this.computeBudgetUsage(
      userId,
      budget.categoryId,
      budget.currency,
      budget.amountLimit,
      userTimezone
    );

    return toBudgetDto(budget, usage);
  }

  async getBudget(userId: string, budgetId: string, userTimezone: string): Promise<BudgetDto> {
    const budget = await this.moneyRepository.findBudgetById(userId, budgetId);
    if (!budget) {
      throw AppError.notFound('Budget not found');
    }

    const usage = await this.computeBudgetUsage(
      userId,
      budget.categoryId,
      budget.currency,
      budget.amountLimit,
      userTimezone
    );

    return toBudgetDto(budget, usage);
  }

  async listBudgets(userId: string, userTimezone: string): Promise<BudgetDto[]> {
    const budgets = await this.moneyRepository.listBudgets(userId);
    const result: BudgetDto[] = [];

    for (const b of budgets) {
      const usage = await this.computeBudgetUsage(
        userId,
        b.categoryId,
        b.currency,
        b.amountLimit,
        userTimezone
      );
      result.push(toBudgetDto(b, usage));
    }

    return result;
  }

  async updateBudget(
    userId: string,
    budgetId: string,
    input: UpdateBudgetInput,
    userTimezone: string
  ): Promise<BudgetDto> {
    const existing = await this.moneyRepository.findBudgetById(userId, budgetId);
    if (!existing) {
      throw AppError.notFound('Budget not found');
    }

    const updated = await this.moneyRepository.updateBudget(userId, budgetId, input, input.version);

    if (!updated) {
      const checkExists = await this.moneyRepository.findBudgetById(userId, budgetId);
      if (checkExists) {
        throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Budget was modified concurrently');
      }
      throw AppError.notFound('Budget not found');
    }

    const usage = await this.computeBudgetUsage(
      userId,
      updated.categoryId,
      updated.currency,
      updated.amountLimit,
      userTimezone
    );

    return toBudgetDto(updated, usage);
  }

  async deleteBudget(userId: string, budgetId: string): Promise<void> {
    const deleted = await this.moneyRepository.softDeleteBudget(userId, budgetId);
    if (!deleted) {
      throw AppError.notFound('Budget not found');
    }
  }

  // ==========================================
  // Reports
  // ==========================================

  async getReportSummary(
    userId: string,
    filter: ReportFilter,
    defaultCurrency: string
  ): Promise<ReportSummaryDto> {
    const summary = await this.moneyRepository.generateReportSummary(userId, {
      ...filter,
      currency: filter.currency ?? defaultCurrency
    });

    return toReportSummaryDto(summary);
  }
}
