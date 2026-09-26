/** Database record to client response (spec section 35). */
import type {
  EventResponse,
  EventWithLink,
  ReminderResponse,
  ReminderWithEntity,
} from './schedule.types';

export function toEventResponse(record: EventWithLink): EventResponse {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    startTime: record.startTime.toISOString(),
    endTime: record.endTime.toISOString(),
    allDay: record.allDay,
    // All three link fields are published, including the id of a target that no
    // longer exists. Dropping the id along with the title would tell the client
    // "not linked", when the truth is "linked to something that was deleted" —
    // a difference the user can act on and the API should not hide.
    linkedType: record.linkedType,
    linkedId: record.linkedId,
    linkedTitle: record.linkedTitle,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toReminderResponse(record: ReminderWithEntity): ReminderResponse {
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    entityTitle: record.entityTitle,
    remindAt: record.remindAt.toISOString(),
    offsetDescription: record.offsetDescription,
    status: record.status,
    sentAt: record.sentAt === null ? null : record.sentAt.toISOString(),
    attempts: record.attempts,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
