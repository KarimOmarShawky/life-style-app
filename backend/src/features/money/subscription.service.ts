/**
 * Subscription business logic.
 *
 * `today` is resolved ONCE per request and passed down, rather than each query
 * calling the clock. Two queries in the same request that straddle midnight
 * would otherwise disagree about which day it is, and a list could contain a
 * subscription whose `daysUntilRenewal` does not match its `nextRenewalDate`.
 */
import { AppError } from '@/core/errors';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './subscription.repository';
import { toSubscriptionResponse } from './money.mapper';
import { serverToday } from './money.dates';
import type {
  CreateSubscriptionInput,
  SubscriptionResponse,
  SubscriptionSummaryResponse,
  UpdateSubscriptionInput,
} from './money.types';

/**
 * The most renewals one "what is coming up" request will return.
 *
 * Unpaginated on purpose: the answer is meant to be read at a glance, and a
 * cursor over a list ordered by a date that changes daily is exactly the
 * instability the repository avoids by not offering that order at all.
 */
export const MAX_UPCOMING = 100;

export class SubscriptionService {
  public async create(
    userId: string,
    input: CreateSubscriptionInput,
  ): Promise<SubscriptionResponse> {
    const subscription = await repository.insertSubscription(userId, serverToday(), input);
    return toSubscriptionResponse(subscription);
  }

  public async getById(userId: string, subscriptionId: string): Promise<SubscriptionResponse> {
    const subscription = await repository.findSubscriptionById(
      userId,
      serverToday(),
      subscriptionId,
    );
    if (!subscription) {
      throw AppError.notFound('Subscription', {
        requestedId: subscriptionId,
        requestedBy: userId,
      });
    }
    return toSubscriptionResponse(subscription);
  }

  public async list(
    userId: string,
    page: PageRequest,
    active: boolean | undefined,
  ): Promise<Page<SubscriptionResponse>> {
    const rows = await repository.listSubscriptions(
      userId,
      serverToday(),
      page.limit,
      page.cursor,
      active,
    );
    const paged = buildPage(rows, page.limit);

    return {
      items: paged.items.map(toSubscriptionResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async upcoming(userId: string, days: number): Promise<SubscriptionResponse[]> {
    const rows = await repository.listUpcomingRenewals(userId, serverToday(), days, MAX_UPCOMING);
    return rows.map(toSubscriptionResponse);
  }

  public async update(
    userId: string,
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<SubscriptionResponse> {
    const updated = await repository.updateSubscription(
      userId,
      serverToday(),
      subscriptionId,
      input,
    );
    if (!updated) {
      throw AppError.notFound('Subscription', {
        requestedId: subscriptionId,
        requestedBy: userId,
      });
    }
    return toSubscriptionResponse(updated);
  }

  public async remove(userId: string, subscriptionId: string): Promise<void> {
    const deleted = await repository.deleteSubscription(userId, subscriptionId);
    if (!deleted) {
      throw AppError.notFound('Subscription', {
        requestedId: subscriptionId,
        requestedBy: userId,
      });
    }
  }

  public async summary(userId: string): Promise<SubscriptionSummaryResponse> {
    return { costs: await repository.subscriptionCosts(userId) };
  }
}
