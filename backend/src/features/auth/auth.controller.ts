/**
 * src/features/auth/auth.controller.ts
 *
 * Implements Section 14.2: Auth Endpoints Controller.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthService, RequestMeta } from './auth.service.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema
} from './auth.validation.js';
import { AppError } from '../../core/errors/app-error.js';

function extractMeta(req: Request): RequestMeta {
  return {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    requestId: (req as unknown as { requestId?: string }).requestId
  };
}

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  public register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = registerSchema.parse(req.body);
      const result = await this.authService.register(input, extractMeta(req));
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  };

  public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = loginSchema.parse(req.body);
      const result = await this.authService.login(input, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = refreshSchema.parse(req.body);
      const result = await this.authService.refresh(input.refreshToken, extractMeta(req));
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  };

  public logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = logoutSchema.parse(req.body ?? {});
      const authHeader = req.headers.authorization;
      const accessToken = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

      await this.authService.logout(
        {
          refreshToken: input.refreshToken,
          accessToken
        },
        extractMeta(req)
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public logoutAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      await this.authService.logoutAll(req.user.id, extractMeta(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  public forgotPassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      await this.authService.forgotPassword(input.email, extractMeta(req));
      // Always return 202 Accepted with indistinguishable empty body
      res.status(202).json({});
    } catch (err) {
      next(err);
    }
  };

  public resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = resetPasswordSchema.parse(req.body);
      await this.authService.resetPassword(input, extractMeta(req));
      res.status(200).json({});
    } catch (err) {
      next(err);
    }
  };

  public changePassword = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user || !req.sessionId) {
        throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
      }
      const input = changePasswordSchema.parse(req.body);
      await this.authService.changePassword(req.user.id, req.sessionId, input, extractMeta(req));
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
