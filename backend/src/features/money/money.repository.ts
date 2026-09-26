/**
 * src/features/money/money.repository.ts
 *
 * Implements Section 4.3 & 6.7: Categories, Transactions, Subscriptions, and Budgets Repository Interface.
 */

import type {
  CategoryEntity,
  TransactionEntity,
  SubscriptionEntity,
  BudgetEntity
} from './money.types.js';

export interface MoneyRepository {
  findCategoryById(userId: string, categoryId: string): Promise<CategoryEntity | null>;
  findTransactionById(userId: string, transactionId: string): Promise<TransactionEntity | null>;
  findSubscriptionById(userId: string, subscriptionId: string): Promise<SubscriptionEntity | null>;
  findBudgetById(userId: string, budgetId: string): Promise<BudgetEntity | null>;
}
