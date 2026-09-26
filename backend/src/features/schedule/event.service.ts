/**
 * Calendar event business logic.
 *
 * Two rules the SQL cannot express on its own live here:
 *
 *   A LINK MUST BE THE CALLER'S. The database checks that `linked_type` is a
 *   known value and that the pair is complete. It cannot check that the target
 *   exists or belongs to this user, because the target table varies per row.
 *   That check is made before the write, and reports the same message whether
 *   the row is missing or someone else's, so it cannot be used to probe ids.
 *
 *   A PARTIAL PATCH CAN STILL INVERT THE TIMES. Moving only `startTime` past the
 *   stored `endTime` is invalid, and nothing in the request shows it. The
 *   database CHECK is what catches it — correctly, and atomically, without a
 *   read-modify-write that could race — and the constraint name is translated
 *   back into the field-level message the client would have got if the request
 *   had carried both ends.
 */
import { AppError } from '@/core/errors';
import { buildPageWith, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './event.repository';
import { entityBelongsToUser } from './schedule.references';
import { toEventResponse } from './schedule.mapper';
import type {
  CreateEventInput,
  EventFilters,
  EventResponse,
  EventLinkType,
  UpdateEventInput,
} from './schedule.types';

/** PostgreSQL check-violation SQLSTATE. */
const CHECK_VIOLATION = '23514';

/** The constraint that keeps an event from ending before it starts. */
const ORDER_CONSTRAINT = 'events_end_after_start';

function violates(error: unknown, constraint: string): boolean {
  if (!(error instanceof Error) || !('code' in error) || !('constraint' in error)) {
    return false;
  }
  const details = error as { code: unknown; constraint: unknown };
  return details.code === CHECK_VIOLATION && details.constraint === constraint;
}

const TIME_ORDER_ISSUE = {
  field: 'endTime',
  message: 'endTime must not be before startTime',
};

export class EventService {
  /**
   * Rejects a link to a row that is missing or not the caller's.
   *
   * `null` means "clear the link" and needs no check. `undefined` means the
   * request did not mention it at all.
   */
  private async assertLinkUsable(
    userId: string,
    linkedType: EventLinkType | null | undefined,
    linkedId: string | null | undefined,
  ): Promise<void> {
    if (linkedType === null || linkedType === undefined) {
      return;
    }
    if (typeof linkedId !== 'string') {
      return;
    }

    const usable = await entityBelongsToUser(userId, linkedType, linkedId);
    if (!usable) {
      throw AppError.validation([
        { field: 'linkedId', message: `linkedId does not refer to one of your ${linkedType}s` },
      ]);
    }
  }

  public async create(userId: string, input: CreateEventInput): Promise<EventResponse> {
    await this.assertLinkUsable(userId, input.linkedType, input.linkedId);

    const event = await repository.insertEvent(userId, input);
    return toEventResponse(event);
  }

  public async getById(userId: string, eventId: string): Promise<EventResponse> {
    const event = await repository.findEventById(userId, eventId);
    if (!event) {
      throw AppError.notFound('Event', { requestedId: eventId, requestedBy: userId });
    }
    return toEventResponse(event);
  }

  public async list(
    userId: string,
    page: PageRequest,
    filters: EventFilters,
  ): Promise<Page<EventResponse>> {
    const rows = await repository.listEvents(userId, page.limit, page.cursor, filters);

    // Built from `startTime`, which is what the scan is ordered by. A cursor
    // made from `createdAt` here would resume a different ordering and drop
    // rows silently rather than fail.
    const paged = buildPageWith(rows, page.limit, (row) => ({
      createdAt: row.startTime.toISOString(),
      id: row.id,
    }));

    return {
      items: paged.items.map(toEventResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<EventResponse> {
    await this.assertLinkUsable(userId, input.linkedType, input.linkedId);

    try {
      const updated = await repository.updateEvent(userId, eventId, input);
      if (!updated) {
        throw AppError.notFound('Event', { requestedId: eventId, requestedBy: userId });
      }
      return toEventResponse(updated);
    } catch (error) {
      if (violates(error, ORDER_CONSTRAINT)) {
        // The request moved one end of the event past the stored other end.
        // Reported against `endTime` whichever end was sent, because that is the
        // field whose relationship to the other one is wrong.
        throw AppError.validation([TIME_ORDER_ISSUE]);
      }
      throw error;
    }
  }

  public async remove(userId: string, eventId: string): Promise<void> {
    const deleted = await repository.deleteEvent(userId, eventId);
    if (!deleted) {
      throw AppError.notFound('Event', { requestedId: eventId, requestedBy: userId });
    }
  }
}
