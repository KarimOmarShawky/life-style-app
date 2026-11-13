/**
 * src/features/ai/ai-assistant.controller.ts
 *
 * HTTP adapter for the assistant turn (Hybrid AI AI-2b):
 *   POST /api/v1/ai/assistant/turn        -> { type: 'answer', text, language }
 *                                          | { type: 'unsupported_or_denied', reason }
 *   POST /api/v1/ai/assistant/turn/stream -> text/event-stream: { text } events
 *                                            and [DONE], or one
 *                                            unsupported_or_denied event and [DONE]
 * Never logs the message, the conversation, the context or the reply.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../core/errors/app-error.js';
import type { AuthenticatedUserContext } from '../../core/security/session-validator.js';
import {
  isSafetyBlock,
  unsupportedDenial,
  type AiAssistantDenial,
  type AiAssistantService
} from './application/ai-assistant.service.js';
import { aiAssistantTurnSchema } from './ai-assistant.validation.js';
import { mapAiProviderError } from './ai.service.js';

/** Validation and app errors pass through; provider failures become safe 502/503s. */
function toClientError(err: unknown): unknown {
  return err instanceof AppError || err instanceof ZodError ? err : mapAiProviderError(err);
}

export class AiAssistantController {
  constructor(private readonly assistant: AiAssistantService) {}

  public turn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = this.requireUser(req);
      const body = aiAssistantTurnSchema.parse(req.body);
      res.status(200).json(await this.assistant.turn(user, body));
    } catch (err) {
      next(toClientError(err));
    }
  };

  public turnStream = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const abort = new AbortController();
    let sentText = false;
    try {
      const user = this.requireUser(req);
      const body = aiAssistantTurnSchema.parse(req.body);
      req.on('close', () => abort.abort());
      const outcome = await this.assistant.prepare(user, body, abort.signal);

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      if ('denied' in outcome) {
        this.writeDenial(res, outcome.denied);
        return;
      }
      for await (const chunk of this.assistant.stream(outcome.prepared)) {
        if (abort.signal.aborted) break;
        sentText = true;
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      if (!abort.signal.aborted) res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      if (abort.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (res.headersSent) {
        mapAiProviderError(err); // logs the failure kind only, never content
        if (!sentText && isSafetyBlock(err)) {
          this.writeDenial(res, unsupportedDenial);
          return;
        }
        res.write(`data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
        res.end();
        return;
      }
      next(toClientError(err));
    }
  };

  private writeDenial(res: Response, denial: AiAssistantDenial): void {
    res.write(`data: ${JSON.stringify(denial)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }

  private requireUser(req: Request): AuthenticatedUserContext {
    if (!req.user) {
      throw AppError.unauthenticated('Authentication required', 'UNAUTHENTICATED');
    }
    return req.user;
  }
}
