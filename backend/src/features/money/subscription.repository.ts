import type {
  CategoryEntity,
  CreateSubscriptionInput,
  ListSubscriptionsFilter,
  SubscriptionEntity,
  UpdateSubscriptionInput
} from './money.types.js';

/** The production subscription port has no financial write or payment methods. */
export interface SubscriptionRepository {
  findCategoryById(userId: string, categoryId: string): Promise<CategoryEntity | null>;
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
  countActiveSubscriptions(userId: string): Promise<number>;
}
