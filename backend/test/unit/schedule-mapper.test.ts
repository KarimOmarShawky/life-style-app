/**
 * Schedule mappers.
 *
 * The property being asserted is what does NOT come out: the owner id, and the
 * distinction between "no link" and "link to something deleted", which the
 * mapper must preserve rather than flatten.
 */
import { describe, expect, it } from 'vitest';

import { toEventResponse, toReminderResponse } from '@/features/schedule/schedule.mapper';
import type { EventWithLink, ReminderWithEntity } from '@/features/schedule/schedule.types';

const CREATED = new Date('2026-09-20T10:00:00.000Z');
const UPDATED = new Date('2026-09-21T11:30:00.000Z');

const event: EventWithLink = {
  id: 'e1',
  userId: 'u1',
  title: 'Report review',
  description: null,
  startTime: new Date('2026-09-24T09:00:00.000Z'),
  endTime: new Date('2026-09-24T10:00:00.000Z'),
  allDay: false,
  linkedType: 'task',
  linkedId: 't1',
  linkedTitle: 'Write the report',
  createdAt: CREATED,
  updatedAt: UPDATED,
};

describe('toEventResponse', () => {
  it('serializes both ends as ISO instants', () => {
    const response = toEventResponse(event);
    expect(response.startTime).toBe('2026-09-24T09:00:00.000Z');
    expect(response.endTime).toBe('2026-09-24T10:00:00.000Z');
  });

  it('does not publish the owner', () => {
    expect(Object.keys(toEventResponse(event))).not.toContain('userId');
  });

  it('publishes exactly the fields the API documents', () => {
    expect(Object.keys(toEventResponse(event)).sort()).toEqual([
      'allDay',
      'createdAt',
      'description',
      'endTime',
      'id',
      'linkedId',
      'linkedTitle',
      'linkedType',
      'startTime',
      'title',
      'updatedAt',
    ]);
  });

  it('keeps a dangling link visible instead of pretending there is none', () => {
    // The target was deleted, so there is no title. Dropping the id too would
    // report "not linked", which is a different and wrong statement.
    const dangling = toEventResponse({ ...event, linkedTitle: null });

    expect(dangling.linkedType).toBe('task');
    expect(dangling.linkedId).toBe('t1');
    expect(dangling.linkedTitle).toBeNull();
  });

  it('distinguishes an unlinked event from a dangling one', () => {
    const unlinked = toEventResponse({
      ...event,
      linkedType: null,
      linkedId: null,
      linkedTitle: null,
    });

    expect(unlinked.linkedId).toBeNull();
  });

  it('carries the all-day bounds through unchanged', () => {
    const allDay = toEventResponse({
      ...event,
      allDay: true,
      startTime: new Date('2026-09-24T00:00:00.000Z'),
      endTime: new Date('2026-09-24T23:59:59.999Z'),
    });

    expect(allDay.allDay).toBe(true);
    expect(allDay.startTime).toBe('2026-09-24T00:00:00.000Z');
    expect(allDay.endTime).toBe('2026-09-24T23:59:59.999Z');
  });
});

const reminder: ReminderWithEntity = {
  id: 'r1',
  userId: 'u1',
  entityType: 'task',
  entityId: 't1',
  entityTitle: 'Write the report',
  remindAt: new Date('2026-09-24T08:00:00.000Z'),
  offsetDescription: '1 hour before',
  status: 'pending',
  sentAt: null,
  attempts: 0,
  createdAt: CREATED,
  updatedAt: UPDATED,
};

describe('toReminderResponse', () => {
  it('leaves sentAt null for a reminder that has not been delivered', () => {
    expect(toReminderResponse(reminder).sentAt).toBeNull();
  });

  it('serializes sentAt once it has been', () => {
    const sent = toReminderResponse({
      ...reminder,
      status: 'sent',
      sentAt: new Date('2026-09-24T08:00:03.000Z'),
    });

    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBe('2026-09-24T08:00:03.000Z');
  });

  it('does not publish the owner', () => {
    expect(Object.keys(toReminderResponse(reminder))).not.toContain('userId');
  });

  it('publishes exactly the fields the API documents', () => {
    expect(Object.keys(toReminderResponse(reminder)).sort()).toEqual([
      'attempts',
      'createdAt',
      'entityId',
      'entityTitle',
      'entityType',
      'id',
      'offsetDescription',
      'remindAt',
      'sentAt',
      'status',
      'updatedAt',
    ]);
  });

  it('reports an orphaned reminder as a null title, keeping the id', () => {
    const orphan = toReminderResponse({ ...reminder, entityTitle: null });

    expect(orphan.entityTitle).toBeNull();
    expect(orphan.entityId).toBe('t1');
    expect(orphan.entityType).toBe('task');
  });
});
