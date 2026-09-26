/** Habit HTTP layer. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import { serverToday, type HabitService } from './habit.service';
import type {
  CreateHabitBody,
  HabitLogsQuery,
  ListHabitsQuery,
  LogHabitBody,
  UpdateHabitBody,
} from './habit.validation';

/** The date streaks are measured against: the client's, or the server's. */
function asOfFrom(req: Request): string {
  const { asOf } = req.query as { asOf?: string };
  return asOf ?? serverToday();
}

export class HabitController {
  constructor(private readonly service: HabitService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(
      res,
      await this.service.create(user.id, req.body as CreateHabitBody, serverToday()),
    );
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListHabitsQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      params.archived,
      params.asOf ?? serverToday(),
    );

    sendPaginated(res, page);
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id']), asOfFrom(req)));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.update(
        user.id,
        String(req.params['id']),
        req.body as UpdateHabitBody,
        serverToday(),
      ),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    res.status(204).end();
  };

  public log = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const body = req.body as LogHabitBody;

    // Streaks in the response are measured as of the later of the server's date
    // and the date being logged. Logging a PAST day must not rewind the numbers
    // to that day, and a client ahead of UTC logging its own today must have the
    // numbers measured against that day rather than the server's yesterday.
    const today = serverToday();
    const asOf = body.date !== undefined && body.date > today ? body.date : today;

    sendSuccess(res, await this.service.log(user.id, String(req.params['id']), body, asOf));
  };

  public removeLog = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.removeLog(
        user.id,
        String(req.params['id']),
        String(req.params['date']),
        serverToday(),
      ),
    );
  };

  public listLogs = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const range = req.query as unknown as HabitLogsQuery;
    sendSuccess(
      res,
      await this.service.listLogs(user.id, String(req.params['id']), range, serverToday()),
    );
  };
}
