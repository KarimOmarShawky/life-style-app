/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline.
 *
 * Express 4 does not await handlers: an async handler that throws produces an
 * unhandled rejection and a request that hangs until timeout, rather than a 500.
 * Every async controller method must be wrapped.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
