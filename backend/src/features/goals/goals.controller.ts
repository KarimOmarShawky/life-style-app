/**
 * src/features/goals/goals.controller.ts
 *
 * Implements Section 14.9 & AC-GOAL-01: Goals & Milestones HTTP Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { GoalsService } from './goals.service.js';
import {
  createGoalSchema,
  updateGoalSchema,
  listGoalsQuerySchema,
  goalIdParamSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
  goalMilestoneParamSchema
} from './goals.validation.js';

export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  public createGoal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const validated = createGoalSchema.parse(req.body);
      const goal = await this.goalsService.createGoal(req.user.id, validated);
      res.status(201).json({ goal });
    } catch (err) {
      next(err);
    }
  };

  public listGoals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listGoalsQuerySchema.parse(req.query);
      const goals = await this.goalsService.listGoals(req.user.id, query);
      res.status(200).json({ goals });
    } catch (err) {
      next(err);
    }
  };

  public getGoal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      const goal = await this.goalsService.getGoal(req.user.id, id);
      res.status(200).json({ goal });
    } catch (err) {
      next(err);
    }
  };

  public updateGoal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      const validated = updateGoalSchema.parse(req.body);
      const goal = await this.goalsService.updateGoal(req.user.id, id, validated);
      res.status(200).json({ goal });
    } catch (err) {
      next(err);
    }
  };

  public deleteGoal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      await this.goalsService.deleteGoal(req.user.id, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };

  public restoreGoal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      const goal = await this.goalsService.restoreGoal(req.user.id, id);
      res.status(200).json({ goal });
    } catch (err) {
      next(err);
    }
  };

  // Milestones endpoints
  public createMilestone = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      const validated = createMilestoneSchema.parse(req.body);
      const milestone = await this.goalsService.createMilestone(req.user.id, id, validated);
      res.status(201).json({ milestone });
    } catch (err) {
      next(err);
    }
  };

  public listMilestones = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = goalIdParamSchema.parse(req.params);
      const milestones = await this.goalsService.listMilestones(req.user.id, id);
      res.status(200).json({ milestones });
    } catch (err) {
      next(err);
    }
  };

  public getMilestone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, milestoneId } = goalMilestoneParamSchema.parse(req.params);
      const milestone = await this.goalsService.getMilestone(req.user.id, id, milestoneId);
      res.status(200).json({ milestone });
    } catch (err) {
      next(err);
    }
  };

  public updateMilestone = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, milestoneId } = goalMilestoneParamSchema.parse(req.params);
      const validated = updateMilestoneSchema.parse(req.body);
      const milestone = await this.goalsService.updateMilestone(
        req.user.id,
        id,
        milestoneId,
        validated
      );
      res.status(200).json({ milestone });
    } catch (err) {
      next(err);
    }
  };

  public deleteMilestone = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id, milestoneId } = goalMilestoneParamSchema.parse(req.params);
      await this.goalsService.deleteMilestone(req.user.id, id, milestoneId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };
}
