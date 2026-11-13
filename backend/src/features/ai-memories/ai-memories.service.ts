/**
 * src/features/ai-memories/ai-memories.service.ts
 *
 * Saving needs both memory switches of the account (AI-2 settings); listing,
 * editing and deleting always work, so people can review and remove what they
 * saved at any time. The assistant reads memories only through `forContext`,
 * and only when the caller checked that memory is on and the AI consent is
 * current.
 */
import { AppError } from '../../core/errors/app-error.js';
import { logger } from '../../core/logger/logger.js';
import type { AiMemoriesRepository } from './ai-memories.repository.js';
import {
  AI_MEMORY_CONTEXT_CAPS,
  AI_MEMORY_LIMITS,
  type AiMemoryForContext,
  type AiMemoryItem,
  type AiMemoryList,
  type AiMemoryListStatus,
  type CreateAiMemoryInput,
  type UpdateAiMemoryInput
} from './ai-memories.types.js';

function memoryUnavailable(): AppError {
  return new AppError({
    httpStatus: 503,
    code: 'AI_MEMORY_UNAVAILABLE',
    safeMessage: 'Assistant memory is not available yet. Please try again later.',
    isOperational: true
  });
}

export class AiMemoriesService {
  constructor(private readonly repo: AiMemoriesRepository) {}

  public async list(userId: string, status: AiMemoryListStatus = 'active'): Promise<AiMemoryList> {
    const result = await this.repo.list(userId, status, AI_MEMORY_LIMITS.listMax);
    if (!result.available) return { items: [], truncated: false, available: false };
    return { items: result.items, truncated: result.truncated, available: true };
  }

  public async create(userId: string, input: CreateAiMemoryInput): Promise<AiMemoryItem> {
    const result = await this.repo.createExplicit(userId, input, AI_MEMORY_LIMITS.maxActive);
    if (!result.available) throw memoryUnavailable();
    if (result.outcome === 'disabled') {
      throw AppError.forbidden('Turn on assistant memory to save memories.', 'AI_MEMORY_DISABLED');
    }
    if (result.outcome === 'limit') {
      throw AppError.conflict(
        'AI_MEMORY_LIMIT',
        `You can keep at most ${AI_MEMORY_LIMITS.maxActive} memories. Delete some to save new ones.`
      );
    }
    return result.item;
  }

  public async update(
    userId: string,
    id: string,
    patch: UpdateAiMemoryInput
  ): Promise<AiMemoryItem> {
    const result = await this.repo.update(userId, id, patch);
    if (!result.available) throw memoryUnavailable();
    if (!result.item) throw AppError.notFound('Memory not found');
    return result.item;
  }

  public async remove(userId: string, id: string): Promise<void> {
    const result = await this.repo.remove(userId, id);
    if (!result.available) throw memoryUnavailable();
    if (result.deleted === 0) throw AppError.notFound('Memory not found');
  }

  public async removeAll(userId: string): Promise<{ deleted: number }> {
    const result = await this.repo.removeAll(userId);
    if (!result.available) throw memoryUnavailable();
    return { deleted: result.deleted };
  }

  /**
   * The memories one assistant turn may carry: the most recently changed
   * active ones within AI_MEMORY_CONTEXT_CAPS. Never fails the turn: without
   * the table or on a read error there are simply no memories.
   */
  public async forContext(userId: string): Promise<AiMemoryForContext[]> {
    try {
      const result = await this.repo.listForContext(userId, AI_MEMORY_CONTEXT_CAPS.items);
      if (!result.available) return [];
      const picked: AiMemoryForContext[] = [];
      let used = 0;
      for (const item of result.items) {
        if (used + item.content.length > AI_MEMORY_CONTEXT_CAPS.chars) break;
        picked.push({ kind: item.kind, content: item.content });
        used += item.content.length;
      }
      return picked;
    } catch {
      // Only the fact; never the user or the memory text.
      logger.warn('AI memories could not be read for an assistant turn');
      return [];
    }
  }
}
