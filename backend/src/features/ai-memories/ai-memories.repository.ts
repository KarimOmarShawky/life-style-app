/**
 * src/features/ai-memories/ai-memories.repository.ts
 */
import type {
  AiMemoryForContext,
  AiMemoryItem,
  AiMemoryListStatus,
  CreateAiMemoryInput,
  UpdateAiMemoryInput
} from './ai-memories.types.js';

/** The owner-run SQL has not created the table yet. */
export interface AiMemoriesUnavailable {
  available: false;
}

export type AiMemoryListResult =
  AiMemoriesUnavailable | { available: true; items: AiMemoryItem[]; truncated: boolean };

export type AiMemoryCreateResult =
  | AiMemoriesUnavailable
  | { available: true; outcome: 'created'; item: AiMemoryItem }
  /** Memory or saving memories is off for the account (or no settings row). */
  | { available: true; outcome: 'disabled' }
  /** The account already has the maximum number of active memories. */
  | { available: true; outcome: 'limit' };

export type AiMemoryUpdateResult =
  AiMemoriesUnavailable | { available: true; item: AiMemoryItem | null };

export type AiMemoryDeleteResult = AiMemoriesUnavailable | { available: true; deleted: number };

export type AiMemoryContextResult =
  AiMemoriesUnavailable | { available: true; items: AiMemoryForContext[] };

export interface AiMemoriesRepository {
  /** The account's items with this status, newest first, at most `limit`. */
  list(userId: string, status: AiMemoryListStatus, limit: number): Promise<AiMemoryListResult>;
  /**
   * Saves an explicit, active memory, atomically with the checks that the
   * account has memory and saving memories switched on and fewer than
   * `maxActive` active memories.
   */
  createExplicit(
    userId: string,
    input: CreateAiMemoryInput,
    maxActive: number
  ): Promise<AiMemoryCreateResult>;
  /** Changes an item of this account; `item` is null when none matched. */
  update(userId: string, id: string, patch: UpdateAiMemoryInput): Promise<AiMemoryUpdateResult>;
  remove(userId: string, id: string): Promise<AiMemoryDeleteResult>;
  removeAll(userId: string): Promise<AiMemoryDeleteResult>;
  /** Active, unexpired items, most recently changed first, at most `limit`. */
  listForContext(userId: string, limit: number): Promise<AiMemoryContextResult>;
}
