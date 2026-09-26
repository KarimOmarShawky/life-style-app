/** Goal HTTP layer. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { GoalService } from './goal.service';
import type {
  CreateGoalBody,
  CreateMilestoneBody,
  ListGoalsQuery,
  UpdateGoalBody,
  UpdateMilestoneBody,
} from './goal.validation';

export class GoalController {
  constructor(private readonly service: GoalService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateGoalBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListGoalsQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      params.status,
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
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateGoalBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };

  public addMilestone = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(
      res,
      await this.service.addMilestone(
        user.id,
        String(req.params['id']),
        req.body as CreateMilestoneBody,
      ),
    );
  };

  public updateMilestone = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.updateMilestone(
        user.id,
        String(req.params['id']),
        String(req.params['milestoneId']),
        req.body as UpdateMilestoneBody,
      ),
    );
  };

  public removeMilestone = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.removeMilestone(
      user.id,
      String(req.params['id']),
      String(req.params['milestoneId']),
    );
    sendNoContent(res);
  };
}
