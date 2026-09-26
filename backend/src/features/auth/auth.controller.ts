/**
 * Auth HTTP layer (spec section 4).
 *
 * Controllers are thin by design: read the request, call the service, send the
 * response. No business rules, no database access, no branching on domain state.
 * Validation already happened in middleware, so `req.body` is typed and clean by
 * the time a method here runs.
 */
import type { Request, Response } from 'express';

import { config } from '@/config';
import { isProduction } from '@/config';
import { AppError, ErrorCode } from '@/core/errors';
import { requireUser } from '@/core/middleware/authenticate';
import { sendCreated, sendNoContent, sendSuccess } from '@/core/utils/api-response';

import type { AuthService } from './auth.service';
import type { ChangePasswordBody, LoginBody, RefreshBody, RegisterBody } from './auth.validation';
import type { RequestOrigin } from './auth.types';

/**
 * Captures request origin for the audit trail.
 *
 * `req.ip` is only trustworthy because `trust proxy` is configured explicitly in
 * app.ts. Left at its default behind a load balancer it reports the balancer's
 * address, making every audit entry and every rate-limit key identical.
 */
function originOf(req: Request): RequestOrigin {
  const userAgent = req.headers['user-agent'];
  return {
    ipAddress: req.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
  };
}

/**
 * Sets the refresh token as an HttpOnly cookie in addition to returning it in
 * the body (spec section 11).
 *
 * The Flutter client ignores the cookie and stores the body value in platform
 * secure storage, which is the right model for mobile. The cookie exists so a
 * future web client gets a token that JavaScript cannot read, and therefore
 * cannot exfiltrate through XSS. SameSite=strict is what keeps that cookie from
 * being a CSRF vector.
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(config.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: `${config.API_PREFIX}/auth`,
    maxAge: config.REFRESH_TOKEN_TTL_SECONDS * 1000,
    ...(config.COOKIE_DOMAIN !== undefined ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(config.REFRESH_COOKIE_NAME, { path: `${config.API_PREFIX}/auth` });
}

export class AuthController {
  constructor(private readonly service: AuthService) {}

  public register = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RegisterBody;
    const result = await this.service.register(
      { email: body.email, password: body.password, displayName: body.displayName },
      originOf(req),
    );

    setRefreshCookie(res, result.tokens.refreshToken);
    sendCreated(res, result);
  };

  public login = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as LoginBody;
    const result = await this.service.login(
      { email: body.email, password: body.password },
      originOf(req),
    );

    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result);
  };

  /**
   * Accepts the refresh token from the request body or from the HttpOnly cookie,
   * body first. This is what lets one backend serve both a mobile client that
   * holds the token itself and a web client that relies on the cookie.
   */
  public refresh = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as RefreshBody;
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = body.refreshToken ?? cookies?.[config.REFRESH_COOKIE_NAME];

    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, {
        message: 'A refresh token is required in the request body or cookie.',
      });
    }

    const result = await this.service.refresh(token, originOf(req));
    setRefreshCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result);
  };

  public logout = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    await this.service.logout(user.sessionId, user.id, originOf(req));
    clearRefreshCookie(res);
    sendNoContent(res);
  };

  public changePassword = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const body = req.body as ChangePasswordBody;

    await this.service.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
      originOf(req),
    );

    clearRefreshCookie(res);
    sendNoContent(res);
  };

  public me = async (req: Request, res: Response): Promise<void> => {
    const user = requireUser(req);
    const profile = await this.service.getProfile(user.id);
    sendSuccess(res, profile);
  };
}
