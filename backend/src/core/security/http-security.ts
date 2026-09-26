/**
 * HTTP security headers and CORS (spec sections 18, 20, 21).
 *
 * The header set is tuned for a JSON API consumed by a Flutter client, not for a
 * server-rendered site. The spec warns against copying a configuration without
 * understanding its effect, so each deviation from Helmet's defaults is
 * explained below.
 */
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import type { RequestHandler } from 'express';

import { config, isProduction } from '@/config';
import { AppError, ErrorCode } from '@/core/errors';
import { createLogger } from '@/core/logger';

const log = createLogger('security');

export function securityHeaders(): RequestHandler {
  return helmet({
    // The API returns JSON, never HTML, so no script can execute from these
    // responses. The policy is still set, as defence in depth for the Swagger UI
    // page and for any future browser-rendered route.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI injects inline styles
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },

    // Stops a browser from second-guessing Content-Type. Without it a JSON
    // response containing attacker-controlled text can be sniffed as HTML and
    // executed, which is one of the few XSS paths a pure JSON API still has.
    noSniff: true,

    frameguard: { action: 'deny' },

    // Send the origin but not the path to other sites, so a URL containing an id
    // is not leaked through the Referer header.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // HSTS only in production: enabling it on http://localhost makes the browser
    // force HTTPS there afterwards, which breaks local development in a way that
    // is genuinely hard to undo.
    hsts: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,

    // Advertising the framework helps nobody but an attacker fingerprinting it.
    hidePoweredBy: true,

    crossOriginResourcePolicy: { policy: 'same-site' },
  });
}

/**
 * CORS.
 *
 * A wildcard origin is never used (spec section 18). Note that CORS is a BROWSER
 * control: it does not protect the API from a native client or a script, both of
 * which ignore it entirely. It is here to stop a malicious web page from making
 * authenticated requests on a signed-in user's behalf, and nothing else. The
 * real access control is authentication plus authorization on every route.
 */
export function corsMiddleware(): RequestHandler {
  const allowed = new Set(config.CORS_ALLOWED_ORIGINS);

  const options: CorsOptions = {
    origin(origin, callback) {
      // A request with no Origin header is not a browser cross-origin request:
      // it is the Flutter app, a mobile HTTP client, curl, or a health probe.
      // Those are allowed here and gated by authentication instead.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }

      if (!isProduction && allowed.size === 0) {
        // Development convenience only. `env.ts` refuses to start in production
        // with an empty origin list, so this branch cannot be reached there.
        callback(null, true);
        return;
      }

      log.warn({ origin }, 'Blocked cross-origin request from an unlisted origin');
      callback(new AppError(ErrorCode.FORBIDDEN, { message: 'Origin not allowed.' }));
    },

    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
    maxAge: 600,
  };

  return cors(options);
}
