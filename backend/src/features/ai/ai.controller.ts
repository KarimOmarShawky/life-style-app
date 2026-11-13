/**
 * src/features/ai/ai.controller.ts
 *
 * HTTP adapter for the AI assistant proxy:
 *   POST /api/v1/ai/chat        -> { reply }
 *   POST /api/v1/ai/chat/stream -> text/event-stream, one { text } JSON
 *                                  payload per event, terminated by [DONE]
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../core/errors/app-error.js';
import type { AuthenticatedUserContext } from '../../core/security/session-validator.js';
import { AiService, mapAiProviderError, validateAiChatBody } from './ai.service.js';

export class AiController {
  constructor(private readonly aiService: AiService) {}

  public chat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = this.requireUser(req);
      const input = validateAiChatBody(req.body);
      const result = await this.aiService.chat(input, { userLocale: user.locale });
      res.status(200).json(result);
    } catch (err) {
      next(err instanceof AppError ? err : mapAiProviderError(err));
    }
  };

  public chatStream = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const abort = new AbortController();
    try {
      const user = this.requireUser(req);
      const input = validateAiChatBody(req.body);

      // Abort the upstream provider call as soon as the client goes away.
      req.on('close', () => abort.abort());

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      for await (const chunk of this.aiService.chatStream(input, {
        signal: abort.signal,
        userLocale: user.locale
      })) {
        if (abort.signal.aborted) break;
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      if (!abort.signal.aborted) {
        res.write('data: [DONE]\n\n');
      }
      res.end();
    } catch (err) {
      if (abort.signal.aborted) {
        // Client disconnected mid-stream; the response is already gone.
        if (!res.writableEnded) res.end();
        return;
      }
      if (res.headersSent) {
        // The stream already started, so the JSON error envelope can no
        // longer be used. Terminate with an error event the client maps to
        // its generic failure state; no provider details are included.
        mapAiProviderError(err); // logs the failure kind only, never content
        res.write(`data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
        res.end();
        return;
      }
      next(err instanceof AppError ? err : mapAiProviderError(err));
    }
  };

  private requireUser(req: Request): AuthenticatedUserContext {
    if (!req.user) {
      throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
    }
    return req.user;
  }
}
