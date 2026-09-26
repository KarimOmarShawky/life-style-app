/** Money HTTP layer: expenses, subscriptions and budgets. */
import type { Request, Response } from 'express';

import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '@/core/utils/api-response';
import { toPageRequest } from '@/core/utils/pagination';

import type { BudgetService } from './budget.service';
import type { ExpenseService } from './expense.service';
import type { SubscriptionService } from './subscription.service';
import type {
  CreateBudgetBody,
  CreateExpenseBody,
  CreateSubscriptionBody,
  ExpenseSummaryQuery,
  ListBudgetsQuery,
  ListExpensesQuery,
  ListSubscriptionsQuery,
  UpcomingRenewalsQuery,
  UpdateBudgetBody,
  UpdateExpenseBody,
  UpdateSubscriptionBody,
} from './money.validation';

export class ExpenseController {
  constructor(private readonly service: ExpenseService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateExpenseBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListExpensesQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      {
        category: params.category,
        currency: params.currency,
        from: params.from,
        to: params.to,
      },
    );

    sendPaginated(res, page);
  };

  /**
   * Mounted before `/:id`, so the literal path wins. Registered the other way
   * round, `summary` would be parsed as an expense id and fail validation.
   */
  public summary = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ExpenseSummaryQuery;
    sendSuccess(res, await this.service.summary(user.id, { from: params.from, to: params.to }));
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id'])));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateExpenseBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}

export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateSubscriptionBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListSubscriptionsQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      params.active,
    );

    sendPaginated(res, page);
  };

  public upcoming = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as UpcomingRenewalsQuery;
    sendSuccess(res, await this.service.upcoming(user.id, params.days));
  };

  public summary = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.summary(user.id));
  };

  public getById = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(res, await this.service.getById(user.id, String(req.params['id'])));
  };

  public update = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendSuccess(
      res,
      await this.service.update(
        user.id,
        String(req.params['id']),
        req.body as UpdateSubscriptionBody,
      ),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}

export class BudgetController {
  constructor(private readonly service: BudgetService) {}

  public create = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    sendCreated(res, await this.service.create(user.id, req.body as CreateBudgetBody));
  };

  public list = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const params = req.query as unknown as ListBudgetsQuery;

    const page = await this.service.list(
      user.id,
      toPageRequest({ limit: params.limit, cursor: params.cursor }),
      params.month,
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
      await this.service.update(user.id, String(req.params['id']), req.body as UpdateBudgetBody),
    );
  };

  public remove = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.remove(user.id, String(req.params['id']));
    sendNoContent(res);
  };
}
