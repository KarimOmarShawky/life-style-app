/**
 * src/features/tasks/tasks.controller.ts
 *
 * Implements Section 14.4: Tasks Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { TasksService } from './tasks.service.js';
import {
  createTaskSchema,
  updateTaskSchema,
  listTasksQuerySchema,
  taskIdParamSchema
} from './tasks.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  public listTasks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listTasksQuerySchema.parse(req.query);
      const userTimezone = req.user.timezone || 'UTC';
      const result = await this.tasksService.listTasks(req.user.id, query, userTimezone);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createTaskSchema.parse(req.body);
      const task = await this.tasksService.createTask(req.user.id, input);
      res.status(201).json({ task });
    } catch (err) {
      next(err);
    }
  };

  public getTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = taskIdParamSchema.parse(req.params);
      const task = await this.tasksService.getTask(req.user.id, id);
      res.status(200).json({ task });
    } catch (err) {
      next(err);
    }
  };

  public updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = taskIdParamSchema.parse(req.params);
      const input = updateTaskSchema.parse(req.body);
      const task = await this.tasksService.updateTask(req.user.id, id, input);
      res.status(200).json({ task });
    } catch (err) {
      next(err);
    }
  };

  public deleteTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = taskIdParamSchema.parse(req.params);
      await this.tasksService.deleteTask(req.user.id, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public restoreTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = taskIdParamSchema.parse(req.params);
      const task = await this.tasksService.restoreTask(req.user.id, id);
      res.status(200).json({ task });
    } catch (err) {
      next(err);
    }
  };
}
