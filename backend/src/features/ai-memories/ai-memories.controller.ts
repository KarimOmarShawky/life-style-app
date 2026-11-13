/**
 * src/features/ai-memories/ai-memories.controller.ts
 */
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { AiMemoriesService } from './ai-memories.service.js';
import {
  aiMemoryIdSchema,
  createAiMemorySchema,
  listAiMemoriesQuerySchema,
  updateAiMemorySchema
} from './ai-memories.validation.js';

export class AiMemoriesController {
  constructor(private readonly service: AiMemoriesService) {}

  public list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const query = listAiMemoriesQuerySchema.parse(req.query);
      const view = await this.service.list(userId, query.status ?? 'active');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(view);
    } catch (err) {
      next(err);
    }
  };

  public create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const body = createAiMemorySchema.parse(req.body);
      const item = await this.service.create(userId, body);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  };

  public update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const id = aiMemoryIdSchema.parse(req.params.id);
      const patch = updateAiMemorySchema.parse(req.body);
      const item = await this.service.update(userId, id, patch);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(item);
    } catch (err) {
      next(err);
    }
  };

  public remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const id = aiMemoryIdSchema.parse(req.params.id);
      await this.service.remove(userId, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public removeAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = this.requireUserId(req);
      const result = await this.service.removeAll(userId);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  private requireUserId(req: Request): string {
    if (!req.user) {
      throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
    }
    return req.user.id;
  }
}
