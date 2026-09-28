/**
 * src/features/money/money.routes.ts
 *
 * Implements Section 14.11: Money Express Router.
 */

import { Router, type RequestHandler } from 'express';
import type { MoneyController } from './money.controller.js';
import { type RateLimiter, createRateLimitMiddleware } from '../../core/middleware/rate-limiter.js';

export function createMoneyRouter(options: {
  controller: MoneyController;
  authenticate: RequestHandler;
  rateLimiter: RateLimiter;
}): Router {
  const router = Router();
  const { controller, authenticate, rateLimiter } = options;

  // Authenticated user rate limit per Section 8.3: 300 req / 60 s
  const userRateLimiter = createRateLimitMiddleware({
    limiter: rateLimiter,
    limit: 300,
    windowSeconds: 60,
    keyGenerator: (req) => `user:${req.user?.id || 'anon'}`
  });

  router.use(authenticate, userRateLimiter);

  // 1. Categories
  router.get('/categories', controller.listCategories);
  router.post('/categories', controller.createCategory);
  router.get('/categories/:id', controller.getCategory);
  router.patch('/categories/:id', controller.updateCategory);
  router.delete('/categories/:id', controller.deleteCategory);

  // 2. Transactions
  router.get('/transactions', controller.listTransactions);
  router.post('/transactions', controller.createTransaction);
  router.get('/transactions/:id', controller.getTransaction);
  router.patch('/transactions/:id', controller.updateTransaction);
  router.delete('/transactions/:id', controller.deleteTransaction);

  // 3. Subscriptions
  router.get('/subscriptions', controller.listSubscriptions);
  router.post('/subscriptions', controller.createSubscription);
  router.get('/subscriptions/:id', controller.getSubscription);
  router.patch('/subscriptions/:id', controller.updateSubscription);
  router.delete('/subscriptions/:id', controller.deleteSubscription);
  router.post('/subscriptions/:id/pay', controller.paySubscription);

  // 4. Budgets
  router.get('/budgets', controller.listBudgets);
  router.post('/budgets', controller.createBudget);
  router.get('/budgets/:id', controller.getBudget);
  router.patch('/budgets/:id', controller.updateBudget);
  router.delete('/budgets/:id', controller.deleteBudget);

  // 5. Reports
  router.get('/reports/summary', controller.getReportSummary);

  return router;
}
