/**
 * src/features/projects/projects.controller.ts
 *
 * Implements Section 14.5: Projects Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ProjectsService } from './projects.service.js';
import {
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema,
  deleteProjectQuerySchema,
  projectIdParamSchema
} from './projects.validation.js';
import { AppError } from '../../core/errors/app-error.js';

export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  public listProjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const query = listProjectsQuerySchema.parse(req.query);
      const result = await this.projectsService.listProjects(req.user.id, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = createProjectSchema.parse(req.body);
      const project = await this.projectsService.createProject(req.user.id, input);
      res.status(201).json({ project });
    } catch (err) {
      next(err);
    }
  };

  public getProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = projectIdParamSchema.parse(req.params);
      const project = await this.projectsService.getProject(req.user.id, id);
      res.status(200).json({ project });
    } catch (err) {
      next(err);
    }
  };

  public updateProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = projectIdParamSchema.parse(req.params);
      const input = updateProjectSchema.parse(req.body);
      const project = await this.projectsService.updateProject(req.user.id, id, input);
      res.status(200).json({ project });
    } catch (err) {
      next(err);
    }
  };

  public deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = projectIdParamSchema.parse(req.params);
      const { cascade } = deleteProjectQuerySchema.parse(req.query);
      await this.projectsService.deleteProject(req.user.id, id, cascade);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public restoreProject = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { id } = projectIdParamSchema.parse(req.params);
      const project = await this.projectsService.restoreProject(req.user.id, id);
      res.status(200).json({ project });
    } catch (err) {
      next(err);
    }
  };
}
