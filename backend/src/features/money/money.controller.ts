/**
 * src/features/money/money.controller.ts
 *
 * Implements Section 14.11: Money HTTP Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { MoneyService } from './money.service.js';
import {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesQuerySchema,
  categoryIdParamSchema,
  createTransactionSchema,
  updateTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdParamSchema,
  paySubscriptionSchema,
  createBudgetSchema,
  updateBudgetSchema,
  budgetIdParamSchema,
  reportSummaryQuerySchema
} from './money.validation.js';

function extractIdempotencyKey(req: Request): string {
  const key = req.header('idempotency-key') || req.header('Idempotency-Key');
  if (
    !key ||
    typeof key !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  ) {
    throw AppError.validation([
      {
        field: 'Idempotency-Key',
        message: 'Idempotency-Key header is required and must be a valid UUID'
      }
    ]);
  }
  return key;
}

export class MoneyController {
  constructor(private readonly moneyService: MoneyService) {}

  // ==========================================
  // Categories
  // ==========================================

  createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createCategorySchema.parse(req.body);
      const category = await this.moneyService.createCategory(req.user.id, input);
      res.status(201).json({ category });
    } catch (err) {
      next(err);
    }
  };

  getCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = categoryIdParamSchema.parse(req.params);
      const category = await this.moneyService.getCategory(req.user.id, id);
      res.status(200).json({ category });
    } catch (err) {
      next(err);
    }
  };

  listCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listCategoriesQuerySchema.parse(req.query);
      const categories = await this.moneyService.listCategories(
        req.user.id,
        query.kind,
        query.includeArchived
      );
      res.status(200).json({ categories });
    } catch (err) {
      next(err);
    }
  };

  updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = categoryIdParamSchema.parse(req.params);
      const input = updateCategorySchema.parse(req.body);
      const category = await this.moneyService.updateCategory(req.user.id, id, input);
      res.status(200).json({ category });
    } catch (err) {
      next(err);
    }
  };

  deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = categoryIdParamSchema.parse(req.params);
      await this.moneyService.deleteCategory(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // Transactions
  // ==========================================

  createTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const idempotencyKey = extractIdempotencyKey(req);
      const input = createTransactionSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';

      const result = await this.moneyService.createTransaction(
        req.user.id,
        {
          ...input,
          idempotencyKey
        },
        {
          requestId: req.id,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        },
        userTimezone
      );

      res.status(result.isReplay ? 200 : 201).json({ transaction: result.transaction });
    } catch (err) {
      next(err);
    }
  };

  getTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = transactionIdParamSchema.parse(req.params);
      const transaction = await this.moneyService.getTransaction(req.user.id, id);
      res.status(200).json({ transaction });
    } catch (err) {
      next(err);
    }
  };

  listTransactions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listTransactionsQuerySchema.parse(req.query);
      const result = await this.moneyService.listTransactions(req.user.id, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  updateTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = transactionIdParamSchema.parse(req.params);
      const input = updateTransactionSchema.parse(req.body);
      const transaction = await this.moneyService.updateTransaction(req.user.id, id, input, {
        requestId: req.id,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.status(200).json({ transaction });
    } catch (err) {
      next(err);
    }
  };

  deleteTransaction = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = transactionIdParamSchema.parse(req.params);
      await this.moneyService.deleteTransaction(req.user.id, id, {
        requestId: req.id,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // Subscriptions
  // ==========================================

  createSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createSubscriptionSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const subscription = await this.moneyService.createSubscription(
        req.user.id,
        input,
        userTimezone
      );
      res.status(201).json({ subscription });
    } catch (err) {
      next(err);
    }
  };

  getSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = subscriptionIdParamSchema.parse(req.params);
      const userTimezone = req.user.timezone || 'UTC';
      const subscription = await this.moneyService.getSubscription(req.user.id, id, userTimezone);
      res.status(200).json({ subscription });
    } catch (err) {
      next(err);
    }
  };

  listSubscriptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listSubscriptionsQuerySchema.parse(req.query);
      const userTimezone = req.user.timezone || 'UTC';
      const result = await this.moneyService.listSubscriptions(req.user.id, query, userTimezone);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  updateSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = subscriptionIdParamSchema.parse(req.params);
      const input = updateSubscriptionSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const subscription = await this.moneyService.updateSubscription(
        req.user.id,
        id,
        input,
        userTimezone
      );
      res.status(200).json({ subscription });
    } catch (err) {
      next(err);
    }
  };

  deleteSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = subscriptionIdParamSchema.parse(req.params);
      await this.moneyService.deleteSubscription(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  paySubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const idempotencyKey = extractIdempotencyKey(req);
      const { id } = subscriptionIdParamSchema.parse(req.params);
      const input = paySubscriptionSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';

      const result = await this.moneyService.paySubscription(
        req.user.id,
        id,
        {
          ...input,
          idempotencyKey
        },
        {
          requestId: req.id,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        },
        userTimezone
      );

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // Budgets
  // ==========================================

  createBudget = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createBudgetSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const budget = await this.moneyService.createBudget(req.user.id, input, userTimezone);
      res.status(201).json({ budget });
    } catch (err) {
      next(err);
    }
  };

  getBudget = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = budgetIdParamSchema.parse(req.params);
      const userTimezone = req.user.timezone || 'UTC';
      const budget = await this.moneyService.getBudget(req.user.id, id, userTimezone);
      res.status(200).json({ budget });
    } catch (err) {
      next(err);
    }
  };

  listBudgets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const userTimezone = req.user.timezone || 'UTC';
      const budgets = await this.moneyService.listBudgets(req.user.id, userTimezone);
      res.status(200).json({ budgets });
    } catch (err) {
      next(err);
    }
  };

  updateBudget = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = budgetIdParamSchema.parse(req.params);
      const input = updateBudgetSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const budget = await this.moneyService.updateBudget(req.user.id, id, input, userTimezone);
      res.status(200).json({ budget });
    } catch (err) {
      next(err);
    }
  };

  deleteBudget = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = budgetIdParamSchema.parse(req.params);
      await this.moneyService.deleteBudget(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // ==========================================
  // Reports
  // ==========================================

  getReportSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = reportSummaryQuerySchema.parse(req.query);
      const defaultCurrency = req.user.defaultCurrency || 'USD';
      const report = await this.moneyService.getReportSummary(req.user.id, query, defaultCurrency);
      res.status(200).json(report);
    } catch (err) {
      next(err);
    }
  };
}
