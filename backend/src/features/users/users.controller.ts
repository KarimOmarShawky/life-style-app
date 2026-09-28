/**
 * src/features/users/users.controller.ts
 *
 * Implements Section 14.3: Users Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { UsersService, RequestMeta } from './users.service.js';
import {
  updateProfileSchema,
  registerDeviceSchema,
  deviceIdParamSchema
} from './users.validation.js';
import { AppError } from '../../core/errors/app-error.js';

function extractMeta(req: Request): RequestMeta {
  return {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    requestId: (req as unknown as { requestId?: string }).requestId
  };
}

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  public getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const user = await this.usersService.getProfile(req.user.id);
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };

  public updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = updateProfileSchema.parse(req.body);
      const user = await this.usersService.updateProfile(req.user.id, input, extractMeta(req));
      res.status(200).json({ user });
    } catch (err) {
      next(err);
    }
  };

  public registerPushDevice = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user || !req.sessionId) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = registerDeviceSchema.parse(req.body);
      const result = await this.usersService.registerPushDevice(req.user.id, req.sessionId, input);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public deletePushDevice = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const { deviceId } = deviceIdParamSchema.parse(req.params);
      await this.usersService.deletePushDevice(req.user.id, deviceId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public scheduleDeletion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const result = await this.usersService.scheduleDeletion(req.user.id, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public cancelDeletion = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const result = await this.usersService.cancelDeletion(req.user.id, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public exportUserData = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const result = await this.usersService.exportUserData(req.user.id, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
