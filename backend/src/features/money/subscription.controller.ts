import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { SubscriptionService } from './subscription.service.js';
import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdParamSchema
} from './money.validation.js';

export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}
  createSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createSubscriptionSchema.parse(req.body);
      const userTimezone = req.user.timezone || 'UTC';
      const subscription = await this.subscriptionService.createSubscription(
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
      const subscription = await this.subscriptionService.getSubscription(
        req.user.id,
        id,
        userTimezone
      );
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
      const result = await this.subscriptionService.listSubscriptions(
        req.user.id,
        query,
        userTimezone
      );
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
      const subscription = await this.subscriptionService.updateSubscription(
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
      await this.subscriptionService.deleteSubscription(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
