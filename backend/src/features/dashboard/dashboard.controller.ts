/** Home summary HTTP layer. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendSuccess } from '@/core/utils/api-response';

import type { DashboardService } from './dashboard.service';

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  public summary = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.summary(user.id));
  };
}
