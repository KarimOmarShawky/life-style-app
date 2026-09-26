/**
 * Note HTTP layer.
 *
 * Thin by design: read the request, call the service, send the response.
 * Validation has already run in middleware, so the bodies and query values read
 * here are parsed and typed.
 */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { NoteService } from './note.service';
import type { CreateNoteBody, ListNotesQuery, UpdateNoteBody } from './note.validation';

export class NoteController {
  constructor(private readonly service: NoteService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateNoteBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListNotesQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      {
        tag: params.tag,
        search: params.search,
        projectId: params.projectId,
        taskId: params.taskId,
        archived: params.archived,
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
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateNoteBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };

  public tags = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.listTags(user.id));
  };

  public reconcile = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.reconcileLinks(user.id));
  };
}
