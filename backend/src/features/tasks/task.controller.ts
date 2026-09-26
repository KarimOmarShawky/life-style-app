/** Task HTTP layer. Thin: read, delegate, respond. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { TaskService } from './task.service';
import type { CreateTaskBody, ListTasksQuery, UpdateTaskBody } from './task.validation';

export class TaskController {
  constructor(private readonly service: TaskService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateTaskBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const q = req.query as unknown as ListTasksQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: q.limit, cursor: q.cursor }),
      {
        status: q.status,
        priority: q.priority,
        projectId: q.projectId,
        dueBefore: q.dueBefore,
        overdue: q.overdue,
        search: q.search,
      },
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
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateTaskBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };

  public startTimer = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.startTimer(user.id, String(req.params['id'])));
  };

  public stopTimer = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.stopTimer(user.id, String(req.params['id'])));
  };

  public timerSessions = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.listTimerSessions(user.id, String(req.params['id'])));
  };
}
