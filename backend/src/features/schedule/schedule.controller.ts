/** Schedule HTTP layer: calendar events and reminders. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { EventService } from './event.service';
import type { ReminderService } from './reminder.service';
import type {
  CreateEventBody,
  CreateReminderBody,
  DueRemindersQuery,
  ListEventsQuery,
  ListRemindersQuery,
  SnoozeReminderBody,
  UpdateEventBody,
  UpdateReminderBody,
} from './schedule.validation';

export class EventController {
  constructor(private readonly service: EventService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateEventBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListEventsQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      { from: params.from, to: params.to, linkedType: params.linkedType },
    );

    sendPaginated(res, page);
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id'])));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateEventBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}

export class ReminderController {
  constructor(private readonly service: ReminderService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateReminderBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListRemindersQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      { status: params.status, entityType: params.entityType, entityId: params.entityId },
    );

    sendPaginated(res, page);
  };

  /**
   * Mounted before `/:id`, so the literal path wins. Registered the other way
   * round, `due` would be parsed as a reminder id and fail validation.
   */
  public due = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as DueRemindersQuery;
    sendSuccess(res, await this.service.due(user.id, params.limit));
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id'])));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateReminderBody),
    );
  };

  public acknowledge = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.acknowledge(user.id, String(req.params['id'])));
  };

  public dismiss = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.dismiss(user.id, String(req.params['id'])));
  };

  public snooze = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const body = req.body as SnoozeReminderBody;
    sendSuccess(res, await this.service.snooze(user.id, String(req.params['id']), body.minutes));
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}
