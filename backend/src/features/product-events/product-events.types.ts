/**
 * src/features/product-events/product-events.types.ts
 *
 * Feature guide G5: content-free product events. The closed list below is
 * mirrored by the CHECK constraint in migration 1792750000000; adding a name
 * requires a new migration, an owner decision and a privacy review.
 */

export const PRODUCT_EVENT_NAMES = [
  'app_opened',
  'onboarding_started',
  'onboarding_completed',
  'onboarding_skipped',
  'task_completed',
  'habit_checked_in'
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

/** Events that count as a "meaningful action" for Activation and D1/D7/D30. */
export const MEANINGFUL_EVENT_NAMES = ['task_completed', 'habit_checked_in'] as const;

export const PRODUCT_EVENT_PLATFORMS = ['android', 'ios', 'unknown'] as const;

export type ProductEventPlatform = (typeof PRODUCT_EVENT_PLATFORMS)[number];

export interface RecordProductEventInput {
  event: ProductEventName;
  platform: ProductEventPlatform;
  appVersion?: string | undefined;
}

export interface ProductEventRecord {
  userId: string;
  event: ProductEventName;
  platform: ProductEventPlatform;
  appVersion: string | null;
  /** Server time; the client never supplies a timestamp. */
  occurredAt: Date;
  /** The user's local calendar day at `occurredAt` (YYYY-MM-DD). */
  occurredOn: string;
}
