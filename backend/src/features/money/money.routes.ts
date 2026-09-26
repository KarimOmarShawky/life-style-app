/**
 * Money routes: three routers from one slice.
 *
 * Expenses, subscriptions and budgets are separate collections to a client but
 * one feature here, because a budget is defined entirely in terms of expenses.
 * Splitting them into three folders would mean the budget slice writing queries
 * against the expenses table across a boundary the architecture says features do
 * not cross. They share a bounded context, so they share a folder.
 *
 * `authenticate` is applied at the router level in each, so no route can be
 * public by omission.
 *
 * ORDER MATTERS in each router: literal paths are registered before `/:id`.
 * Express matches in registration order, so `/expenses/summary` declared after
 * `/expenses/:id` would be handled as an expense whose id is "summary" and
 * rejected as a malformed UUID.
 */
import { Router } from 'express';

import { getContainer } from '@/core/container';
import { asyncHandler } from '@/core/middleware/async-handler';
import { createAuthenticate } from '@/core/middleware/authenticate';
import { validate } from '@/core/middleware/validate';
import { idParamSchema } from '@/core/validation/common';

import {
  createBudgetSchema,
  createExpenseSchema,
  createSubscriptionSchema,
  expenseSummaryQuerySchema,
  listBudgetsQuerySchema,
  listExpensesQuerySchema,
  listSubscriptionsQuerySchema,
  upcomingRenewalsQuerySchema,
  updateBudgetSchema,
  updateExpenseSchema,
  updateSubscriptionSchema,
} from './money.validation';

export function createExpenseRouter(): Router {
  const router = Router();
  const { expenseController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.get(
    '/summary',
    validate({ query: expenseSummaryQuerySchema }),
    asyncHandler(expenseController.summary),
  );

  router.post('/', validate({ body: createExpenseSchema }), asyncHandler(expenseController.create));

  router.get(
    '/',
    validate({ query: listExpensesQuerySchema }),
    asyncHandler(expenseController.list),
  );

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(expenseController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateExpenseSchema }),
    asyncHandler(expenseController.update),
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(expenseController.remove),
  );

  return router;
}

export function createSubscriptionRouter(): Router {
  const router = Router();
  const { subscriptionController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.get(
    '/upcoming',
    validate({ query: upcomingRenewalsQuerySchema }),
    asyncHandler(subscriptionController.upcoming),
  );

  router.get('/summary', asyncHandler(subscriptionController.summary));

  router.post(
    '/',
    validate({ body: createSubscriptionSchema }),
    asyncHandler(subscriptionController.create),
  );

  router.get(
    '/',
    validate({ query: listSubscriptionsQuerySchema }),
    asyncHandler(subscriptionController.list),
  );

  router.get(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(subscriptionController.getById),
  );

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateSubscriptionSchema }),
    asyncHandler(subscriptionController.update),
  );

  router.delete(
    '/:id',
    validate({ params: idParamSchema }),
    asyncHandler(subscriptionController.remove),
  );

  return router;
}

export function createBudgetRouter(): Router {
  const router = Router();
  const { budgetController, tokenService } = getContainer();

  router.use(createAuthenticate(tokenService));

  router.post('/', validate({ body: createBudgetSchema }), asyncHandler(budgetController.create));

  router.get('/', validate({ query: listBudgetsQuerySchema }), asyncHandler(budgetController.list));

  router.get('/:id', validate({ params: idParamSchema }), asyncHandler(budgetController.getById));

  router.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateBudgetSchema }),
    asyncHandler(budgetController.update),
  );

  router.delete('/:id', validate({ params: idParamSchema }), asyncHandler(budgetController.remove));

  return router;
}
