/**
 * Schedule routes: events and reminders from one slice.
 *
 * They share a folder because the query that decides whether a reminder is still
 * deliverable reads the events table. Two folders would mean one feature
 * querying another's tables, which is the boundary vertical slices exist to
 * keep (see schedule.types).
 *
 * `authenticate` is applied at the router level in each, so no route can be
 * public by omission.
 *
 * ORDER MATTERS: `/due` is registered before `/:id`. Express matches in
 * registration order, so the other way round it would be handled as a reminder
 * whose id is "due" and rejected as a malformed UUID.
 *
 * THE THREE ACTION ROUTES ARE POSTs, NOT PATCHes. Acknowledging, dismissing and
 * snoozing are not field assignments — each one moves the row through a
 * transition with its own rules, and `PATCH {status: "sent"}` would invite a
 * client to set `sent_at` or `attempts` to whatever it liked. The state machine
 * stays in the service, and the client names the action instead of the result.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema } from '@/core/validation/common';

import {
  createEventSchema,
  createReminderSchema,
  dueRemindersQuerySchema,
  listEventsQuerySchema,
  listRemindersQuerySchema,
  snoozeReminderSchema,
  updateEventSchema,
  updateReminderSchema,
} from './schedule.validation';

export function createEventRouter(): Router {
  const router = Router();
  const { eventController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createEventSchema }), asyncHandler(eventController.create));

  router.get('/', validate({ query: listEventsQuerySchema }), asyncHandler(eventController.list));

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(eventController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateEventSchema }),
    asyncHandler(eventController.update),
  );

  router.delete('/:id', validate({ params: idParamSchema }), asyncHandler(eventController.remove));

  return router;
}

export function createReminderRouter(): Router {
  const router = Router();
  const { reminderController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.get(
    '/due',
    validate({ query: dueRemindersQuerySchema }),
    asyncHandler(reminderController.due),
  );

  router.post(
    '/',
    validate({ body: createReminderSchema }),
    asyncHandler(reminderController.create),
  );

  router.get(
    '/',
    validate({ query: listRemindersQuerySchema }),
    asyncHandler(reminderController.list),
  );

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(reminderController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateReminderSchema }),
    asyncHandler(reminderController.update),
  );

  router.post(
    '/:id/acknowledge',
    validate({ params: idParamSchema }),
    asyncHandler(reminderController.acknowledge),
  );

  router.post(
    '/:id/dismiss',
    validate({ params: idParamSchema }),
    asyncHandler(reminderController.dismiss),
  );

  router.post(
    '/:id/snooze',
    validate({ params: idParamSchema, body: snoozeReminderSchema }),
    asyncHandler(reminderController.snooze),
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(reminderController.remove),
  );

  return router;
}
