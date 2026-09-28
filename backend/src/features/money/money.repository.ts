/**
 * src/features/money/money.repository.ts
 *
 * Implements Section 4.3 & 6.7: Money domain repository interface.
 */

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

export interface AuditLogData {
  actorType: 'user' | 'system';
  actorUserId?: string | null | undefined;
  sessionId?: string | null | undefined;
  eventType: string;
  outcome: 'success' | 'failure';
  entityType?: string | null | undefined;
  entityId?: string | null | undefined;
  requestId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface MoneyRepository {
  // Categories
  createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryEntity>;
  findCategoryById(userId: string, categoryId: string): Promise<CategoryEntity | null>;
  findCategoryByName(
    userId: string,
    kind: TransactionKind,
    name: string
  ): Promise<CategoryEntity | null>;
  listCategories(
    userId: string,
    kind?: TransactionKind | undefined,
    includeArchived?: boolean | undefined
  ): Promise<CategoryEntity[]>;
  updateCategory(
    userId: string,
    categoryId: string,
    input: UpdateCategoryInput,
    expectedVersion?: number | undefined
  ): Promise<CategoryEntity | null>;
  archiveCategory(userId: string, categoryId: string): Promise<boolean>;
  countActiveCategories(userId: string): Promise<number>;

  // Transactions
  createTransaction(
    userId: string,
    input: CreateTransactionInput,
    auditData: AuditLogData
  ): Promise<TransactionEntity>;
  findTransactionById(userId: string, transactionId: string): Promise<TransactionEntity | null>;
  findTransactionByIdempotencyKey(
    userId: string,
    idempotencyKey: string
  ): Promise<TransactionEntity | null>;
  listTransactions(
    userId: string,
    filter: ListTransactionsFilter
  ): Promise<{ transactions: TransactionEntity[]; hasMore: boolean; nextCursor: string | null }>;
  updateTransaction(
    userId: string,
    transactionId: string,
    input: UpdateTransactionInput,
    auditData: AuditLogData,
    expectedVersion?: number | undefined
  ): Promise<TransactionEntity | null>;
  softDeleteTransaction(
    userId: string,
    transactionId: string,
    auditData: AuditLogData
  ): Promise<boolean>;
  countActiveTransactions(userId: string): Promise<number>;

  // Subscriptions
  createSubscription(userId: string, input: CreateSubscriptionInput): Promise<SubscriptionEntity>;
  findSubscriptionById(userId: string, subscriptionId: string): Promise<SubscriptionEntity | null>;
  listSubscriptions(
    userId: string,
    filter: ListSubscriptionsFilter
  ): Promise<{ subscriptions: SubscriptionEntity[]; hasMore: boolean; nextCursor: string | null }>;
  updateSubscription(
    userId: string,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
    expectedVersion?: number | undefined
  ): Promise<SubscriptionEntity | null>;
  softDeleteSubscription(userId: string, subscriptionId: string): Promise<boolean>;
  paySubscription(
    userId: string,
    subscriptionId: string,
    input: PaySubscriptionInput,
    newNextBillingDate: string,
    auditEvents: { transactionAudit: AuditLogData; subscriptionAudit: AuditLogData }
  ): Promise<{ transaction: TransactionEntity; subscription: SubscriptionEntity }>;
  countActiveSubscriptions(userId: string): Promise<number>;

  // Budgets
  createBudget(userId: string, input: CreateBudgetInput): Promise<BudgetEntity>;
  findBudgetById(userId: string, budgetId: string): Promise<BudgetEntity | null>;
  findActiveBudgetByTarget(
    userId: string,
    categoryId: string | null,
    currency: string,
    period: BudgetPeriod
  ): Promise<BudgetEntity | null>;
  listBudgets(userId: string): Promise<BudgetEntity[]>;
  updateBudget(
    userId: string,
    budgetId: string,
    input: UpdateBudgetInput,
    expectedVersion?: number | undefined
  ): Promise<BudgetEntity | null>;
  softDeleteBudget(userId: string, budgetId: string): Promise<boolean>;
  calculateBudgetSpent(
    userId: string,
    categoryId: string | null,
    currency: string,
    periodStart: string,
    periodEnd: string
  ): Promise<string>;
  countActiveBudgets(userId: string): Promise<number>;

  // Reports
  generateReportSummary(userId: string, filter: ReportFilter): Promise<ReportSummary>;
}
