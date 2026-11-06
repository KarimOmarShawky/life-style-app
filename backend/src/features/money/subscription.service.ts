import { AppError } from '../../core/errors/app-error.js';
import { getUserTodayDate } from '../../core/time/date-utils.js';
import type { ReminderCancellationPort } from '../reminders/reminder-cancellation.port.js';
import type { SubscriptionRepository } from './subscription.repository.js';
import {
  assertMoneyAmount,
  effectiveMoneyAmount,
  assertMoneyCategory
} from './money.invariants.js';
import type {
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
  ListSubscriptionsFilter
} from './money.types.js';
import { toSubscriptionDto, type SubscriptionDto } from './money.dto.js';
import { calculateInitialNextBillingDate } from './money.cycle.js';

const MAX_SUBSCRIPTIONS_PER_USER = 200;
function getUserToday(timezone: string): string {
  return getUserTodayDate(timezone);
}

export class SubscriptionService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly remindersRepository: ReminderCancellationPort
  ) {}
  async createSubscription(
    userId: string,
    input: CreateSubscriptionInput,
    userTimezone: string
  ): Promise<SubscriptionDto> {
    const activeCount = await this.subscriptionRepository.countActiveSubscriptions(userId);
    if (activeCount >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw AppError.conflict(
        'QUOTA_EXCEEDED',
        `Subscriptions quota exceeded (max ${MAX_SUBSCRIPTIONS_PER_USER} active subscriptions)`
      );
    }

    if (input.categoryId) {
      const category = await this.subscriptionRepository.findCategoryById(userId, input.categoryId);
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

    assertMoneyAmount(input.amount, input.currency);
    const userToday = getUserToday(userTimezone);
    const initialNextBilling =
      input.nextBillingDate ??
      calculateInitialNextBillingDate(
        input.anchorDate,
        userToday,
        input.billingUnit,
        input.billingInterval ?? 1
      );

    const sub = await this.subscriptionRepository.createSubscription(userId, {
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
    const sub = await this.subscriptionRepository.findSubscriptionById(userId, subscriptionId);
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
    const result = await this.subscriptionRepository.listSubscriptions(userId, filter);
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
    const existing = await this.subscriptionRepository.findSubscriptionById(userId, subscriptionId);
    if (!existing) {
      throw AppError.notFound('Subscription not found');
    }

    assertMoneyAmount(
      effectiveMoneyAmount(input.amount, existing.amount, existing.amountScale),
      input.currency ?? existing.currency,
      'amount'
    );
    const categoryId = input.categoryId !== undefined ? input.categoryId : existing.categoryId;
    if (categoryId) {
      const category = await this.subscriptionRepository.findCategoryById(userId, categoryId);
      if (!category) throw AppError.notFound('Category not found');
      assertMoneyCategory(category, 'expense');
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

    const updated = await this.subscriptionRepository.updateSubscription(
      userId,
      subscriptionId,
      {
        ...input,
        cancelledOn
      },
      input.version
    );

    if (!updated) {
      const checkExists = await this.subscriptionRepository.findSubscriptionById(
        userId,
        subscriptionId
      );
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
    const deleted = await this.subscriptionRepository.softDeleteSubscription(
      userId,
      subscriptionId
    );
    if (!deleted) {
      throw AppError.notFound('Subscription not found');
    }
    // Reminders of a soft-deleted subscription must never fire (FR-REM lifecycle).
    await this.remindersRepository.cancelPendingFor('subscription', subscriptionId);
  }
}
