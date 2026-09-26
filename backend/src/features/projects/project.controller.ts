/**
 * Project HTTP layer.
 *
 * Thin: read the request, call the service, send the response. Validation has
 * already run in middleware, so `req.body` is parsed and typed here.
 */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { ProjectService } from './project.service';
import type { CreateProjectBody, UpdateProjectBody } from './project.validation';

export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const body = req.body as CreateProjectBody;
    sendCreated(res, await this.service.create(user.id, body));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const queryParams = req.query as { limit?: number; cursor?: string };

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: queryParams.limit, cursor: queryParams.cursor }),
    );

    sendPaginated(res, page);
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    // `req.params.id` is a validated UUID by the time this runs.
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id'])));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const body = req.body as UpdateProjectBody;
    sendSuccess(res, await this.service.update(user.id, String(req.params['id']), body));
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}
