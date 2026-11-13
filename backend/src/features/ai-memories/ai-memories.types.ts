/**
 * src/features/ai-memories/ai-memories.types.ts
 *
 * Hybrid AI slice AI-3: explicit memory (owner decision D4). Short texts the
 * user asks the assistant to remember. In AI-3 only the user writes them (the
 * Memory screen, or "Save to memory" on one of their own messages); the model
 * never does. Learned items (source 'learned', status 'pending') belong to
 * AI-5 and are not created here.
 *
 *   GET    /api/v1/ai/memories?status=active|pending
 *   POST   /api/v1/ai/memories
 *   PATCH  /api/v1/ai/memories/:id
 *   DELETE /api/v1/ai/memories/:id
 *   DELETE /api/v1/ai/memories
 */

export const AI_MEMORY_KINDS = ['preference', 'fact'] as const;
export type AiMemoryKind = (typeof AI_MEMORY_KINDS)[number];

export const AI_MEMORY_SOURCES = ['explicit', 'learned'] as const;
export type AiMemorySource = (typeof AI_MEMORY_SOURCES)[number];

export const AI_MEMORY_STATUSES = ['pending', 'active', 'dismissed'] as const;
export type AiMemoryStatus = (typeof AI_MEMORY_STATUSES)[number];

/** Statuses a client may list; dismissed items are never listed. */
export const AI_MEMORY_LIST_STATUSES = ['active', 'pending'] as const;
export type AiMemoryListStatus = (typeof AI_MEMORY_LIST_STATUSES)[number];

export const AI_MEMORY_LIMITS = {
  /** Characters per memory (also a database check). */
  contentMaxChars: 500,
  /** Active memories per account; one more answers 409 AI_MEMORY_LIMIT. */
  maxActive: 100,
  /** Items per list response; `truncated` says when more exist. */
  listMax: 100,
  /** Export bound (100 active plus room for AI-5); overflow answers 413. */
  exportMax: 1000
} as const;

/**
 * What one assistant turn may carry: the most recently changed active
 * memories, at most this many and this many characters in total. Keeps the
 * request (and its cost) small; the Memory screen says so.
 */
export const AI_MEMORY_CONTEXT_CAPS = {
  items: 30,
  chars: 6000
} as const;

export interface AiMemoryItem {
  id: string;
  kind: AiMemoryKind;
  content: string;
  source: AiMemorySource;
  status: AiMemoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiMemoryList {
  items: AiMemoryItem[];
  /** True when more items exist than were returned. */
  truncated: boolean;
  /** False until the owner-run SQL has created the table; the list is then empty. */
  available: boolean;
}

/** A memory as the assistant sees it: no ids, dates or statuses. */
export interface AiMemoryForContext {
  kind: AiMemoryKind;
  content: string;
}

export interface CreateAiMemoryInput {
  kind: AiMemoryKind;
  content: string;
}

export interface UpdateAiMemoryInput {
  kind?: AiMemoryKind | undefined;
  content?: string | undefined;
}
