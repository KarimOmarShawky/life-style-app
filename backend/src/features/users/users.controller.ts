import { ZodError } from 'zod';
import { once } from 'node:events';
import { ACCOUNT_ARCHIVE_LIMITS } from './account-archive.js';
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
  deviceIdParamSchema,
  reauthenticationSchema
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
      const { currentPassword } = reauthenticationSchema.parse(req.body);
      await this.usersService.reauthenticate(req.user.id, currentPassword);
      const result = await this.usersService.scheduleDeletion(
        req.user.id,
        extractMeta(req),
        req.sessionId
      );
      res.status(202).json(result);
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
      await this.usersService.cancelDeletion(req.user.id, extractMeta(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public exportUserArchive = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const abort = new AbortController();
    const stop = () => abort.abort();
    const timer = setTimeout(() => {
      stop();
      res.destroy();
    }, ACCOUNT_ARCHIVE_LIMITS.durationMs);
    timer.unref();
    req.once('aborted', stop);
    res.once('close', stop);
    let archive: AsyncGenerator<string> | undefined;
    try {
      if (!req.user) throw AppError.unauthenticated();
      const { currentPassword } = reauthenticationSchema.parse(req.body);
      await this.usersService.reauthenticate(req.user.id, currentPassword);
      if (abort.signal.aborted)
        throw AppError.serviceUnavailable('Account archive interrupted; retry later');
      archive = this.usersService.streamUserArchive(req.user.id, abort.signal, extractMeta(req));
      // Preflight the snapshot/profile before sending headers: 404/DB failures stay ordinary errors.
      const first = await archive.next();
      if (first.done) throw AppError.serviceUnavailable('Account archive interrupted; retry later');
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="lifestyle-domain-archive-v1.ndjson"'
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
      const write = async (line: string) => {
        if (abort.signal.aborted || res.destroyed)
          throw AppError.serviceUnavailable('Account archive interrupted; retry later');
        if (!res.write(line)) await once(res, 'drain', { signal: abort.signal });
      };
      await write(first.value);
      for await (const line of archive) await write(line);
      res.end();
    } catch (err) {
      if (res.headersSent) {
        // Never append a JSON error envelope or a fake completion record to a partial archive.
        stop();
        res.destroy();
      } else if (!res.destroyed) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('X-Accel-Buffering');
        const safe =
          err instanceof AppError || err instanceof ZodError
            ? err
            : AppError.serviceUnavailable('Account archive unavailable; retry later');
        next(safe);
      }
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', stop);
      res.removeListener('close', stop);
      if (archive) await archive.return(undefined);
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
      const { currentPassword } = reauthenticationSchema.parse(req.body);
      await this.usersService.reauthenticate(req.user.id, currentPassword);
      const result = await this.usersService.exportUserData(req.user.id, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };
}
