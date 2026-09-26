/**
 * Calendar event and reminder domain types.
 *
 * TWO ENTITIES, ONE SLICE. A reminder may point at an event, and the query that
 * decides whether a reminder is still deliverable has to read the events table.
 * Splitting them into separate folders would mean one feature querying another's
 * table, which is the boundary the architecture says features do not cross.
 *
 * BOTH CARRY A POLYMORPHIC REFERENCE. An event may link to a task or a habit; a
 * reminder always points at a task, habit, subscription or event. PostgreSQL
 * cannot declare a foreign key whose target table varies per row, so everything
 * a foreign key would have given for free is done explicitly:
 *
 *   WRITE TIME  the target must exist and belong to the caller, checked in one
 *               query that is both the existence test and the ownership test.
 *   READ TIME   the target's title is resolved in the same statement. A target
 *               that has since been deleted resolves to null, which is how a
 *               dangling reference is reported rather than hidden.
 *   DELIVERY    a reminder whose target is gone is never due. The filter is in
 *               the query, so it cannot be forgotten at a call site.
 */

/** Entities an event may be attached to (CHECK constraint `events_linked_type_valid`). */
export const EVENT_LINK_TYPES = ['task', 'habit'] as const;
export type EventLinkType = (typeof EVENT_LINK_TYPES)[number];

/** Entities a reminder may fire for (CHECK constraint `reminders_entity_type_valid`). */
export const REMINDER_ENTITY_TYPES = ['task', 'habit', 'subscription', 'event'] as const;
export type ReminderEntityType = (typeof REMINDER_ENTITY_TYPES)[number];

/** Reminder lifecycle (CHECK constraint `reminders_status_valid`). */
export const REMINDER_STATUSES = ['pending', 'sent', 'dismissed', 'failed'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

// --- Events -----------------------------------------------------------------

export interface EventRecord {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly description: string | null;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly allDay: boolean;
  readonly linkedType: EventLinkType | null;
  readonly linkedId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** An event plus the title of whatever it links to, resolved in the same query. */
export interface EventWithLink extends EventRecord {
  /**
   * Null when there is no link AND when the link dangles.
   *
   * The two cases are told apart by `linkedId`: an id with no title is a target
   * that has been deleted since. Collapsing them into one value would be wrong;
   * keeping the id lets a client say "linked item no longer exists" instead of
   * silently dropping the connection.
   */
  readonly linkedTitle: string | null;
}

export interface EventResponse {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly allDay: boolean;
  readonly linkedType: EventLinkType | null;
  readonly linkedId: string | null;
  readonly linkedTitle: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateEventInput {
  readonly title: string;
  readonly description?: string | null | undefined;
  readonly startTime: string;
  readonly endTime: string;
  readonly allDay?: boolean | undefined;
  readonly linkedType?: EventLinkType | null | undefined;
  readonly linkedId?: string | null | undefined;
}

export interface UpdateEventInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly startTime?: string | undefined;
  readonly endTime?: string | undefined;
  readonly allDay?: boolean | undefined;
  readonly linkedType?: EventLinkType | null | undefined;
  readonly linkedId?: string | null | undefined;
}

/** Window for a calendar view. Either end may stand alone. */
export interface EventFilters {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly linkedType?: EventLinkType | undefined;
}

// --- Reminders --------------------------------------------------------------

export interface ReminderRecord {
  readonly id: string;
  readonly userId: string;
  readonly entityType: ReminderEntityType;
  readonly entityId: string;
  readonly remindAt: Date;
  readonly offsetDescription: string | null;
  readonly status: ReminderStatus;
  readonly sentAt: Date | null;
  readonly attempts: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReminderWithEntity extends ReminderRecord {
  /** Null exactly when the entity this reminder points at no longer exists. */
  readonly entityTitle: string | null;
}

export interface ReminderResponse {
  readonly id: string;
  readonly entityType: ReminderEntityType;
  readonly entityId: string;
  readonly entityTitle: string | null;
  readonly remindAt: string;
  readonly offsetDescription: string | null;
  readonly status: ReminderStatus;
  readonly sentAt: string | null;
  /**
   * Delivery attempts. Always 0 today: nothing in this API pushes a
   * notification, so nothing can fail to. Published because it is part of the
   * row and a future delivery worker will write it, and a field that appears
   * later is a breaking change for a client that did not expect it.
   */
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateReminderInput {
  readonly entityType: ReminderEntityType;
  readonly entityId: string;
  readonly remindAt: string;
  readonly offsetDescription?: string | null | undefined;
}

export interface UpdateReminderInput {
  readonly remindAt?: string | undefined;
  readonly offsetDescription?: string | null | undefined;
}

export interface ReminderFilters {
  readonly status?: ReminderStatus | undefined;
  readonly entityType?: ReminderEntityType | undefined;
  readonly entityId?: string | undefined;
}
