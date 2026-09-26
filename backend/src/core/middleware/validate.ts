/**
 * Request validation middleware (spec section 13).
 *
 * TypeScript types vanish at runtime, so an incoming JSON body is `unknown` no
 * matter how it is annotated. Every external input passes through a Zod schema
 * here, before any controller or service sees it.
 *
 * The middleware REPLACES `req.body`, `req.query` and `req.params` with the
 * parsed results. That matters: Zod strips unknown keys, so a request carrying
 * `{ email, password, isAdmin: true }` reaches the controller without the
 * injected field, rather than relying on the service to ignore it. It is also
 * what blocks operator injection into MongoDB, since `$ne` and friends arrive as
 * unknown keys or wrong types and are stripped or rejected (spec section 15).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

import { AppError } from '@/core/errors';
import { zodToFieldIssues } from '@/core/errors/normalize';
import type { ZodError } from 'zod';

export interface ValidationSchemas {
  readonly body?: ZodTypeAny;
  readonly query?: ZodTypeAny;
  readonly params?: ZodTypeAny;
  readonly headers?: ZodTypeAny;
}

/**
 * Validates the named request parts against the given schemas. All parts are
 * checked before failing, so the client receives every problem at once rather
 * than discovering them one request at a time.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const issues: { field: string; message: string }[] = [];

    const applyPart = <T extends ZodTypeAny>(
      schema: T | undefined,
      value: unknown,
      prefix: string,
      assign: (parsed: z.infer<T>) => void,
    ): void => {
      if (!schema) {
        return;
      }

      const result = schema.safeParse(value);
      if (result.success) {
        assign(result.data);
        return;
      }

      for (const issue of zodToFieldIssues(result.error as ZodError)) {
        issues.push({
          field: issue.field.length > 0 ? `${prefix}.${issue.field}` : prefix,
          message: issue.message,
        });
      }
    };

    applyPart(schemas.body, req.body, 'body', (parsed) => {
      req.body = parsed;
    });

    applyPart(schemas.params, req.params, 'params', (parsed) => {
      req.params = parsed as Request['params'];
    });

    applyPart(schemas.query, req.query, 'query', (parsed) => {
      // Express 4 defines `query` as a getter on some versions; assigning to the
      // validated copy keeps downstream code reading only sanitized values.
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    });

    applyPart(schemas.headers, req.headers, 'headers', () => {
      // Headers are validated but never replaced: Node and Express read from the
      // original object internally, and swapping it breaks keep-alive handling.
    });

    if (issues.length > 0) {
      next(AppError.validation(issues));
      return;
    }

    next();
  };
}
