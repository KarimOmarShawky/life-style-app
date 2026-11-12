/**
 * src/features/ai-memories/ai-memories.repository.pg.ts
 *
 * Every statement is scoped by user_id. Until the owner-run SQL creates
 * ai_memory_items, every method reports `available: false` instead of
 * failing (G2 pattern), so the rest of the API keeps working.
 */
import type pg from 'pg';
import { logger } from '../../core/logger/logger.js';
import { isMissingSchemaObject } from '../../infrastructure/database/postgres/schema-capabilities.js';
import type {
  AiMemoriesRepository,
  AiMemoriesUnavailable,
  AiMemoryContextResult,
  AiMemoryCreateResult,
  AiMemoryDeleteResult,
  AiMemoryListResult,
  AiMemoryUpdateResult
} from './ai-memories.repository.js';
import type {
  AiMemoryItem,
  AiMemoryKind,
  AiMemoryListStatus,
  AiMemorySource,
  AiMemoryStatus,
  CreateAiMemoryInput,
  UpdateAiMemoryInput
} from './ai-memories.types.js';

export interface AiMemoryRow {
  id: string;
  kind: string;
  content: string;
  source: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export const AI_MEMORY_COLUMNS = 'id, kind, content, source, status, created_at, updated_at';

export function aiMemoryFromRow(row: AiMemoryRow): AiMemoryItem {
  return {
    id: row.id,
    kind: row.kind as AiMemoryKind,
    content: row.content,
    source: row.source as AiMemorySource,
    status: row.status as AiMemoryStatus,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

let warnedUnavailable = false;

function noteUnavailable(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  // No user data: only the fact that the owner-run DDL is still pending.
  logger.warn('AI memory schema is not applied yet; memory is unavailable');
}

const unavailable: AiMemoriesUnavailable = { available: false };

export class PgAiMemoriesRepository implements AiMemoriesRepository {
  constructor(private readonly pool: Pick<pg.Pool, 'query' | 'connect'>) {}

  public async list(
    userId: string,
    status: AiMemoryListStatus,
    limit: number
  ): Promise<AiMemoryListResult> {
    return this.guard(async () => {
      const res = await this.pool.query<AiMemoryRow>(
        `SELECT ${AI_MEMORY_COLUMNS} FROM ai_memory_items
         WHERE user_id = $1 AND status = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [userId, status, limit + 1]
      );
      return {
        available: true as const,
        items: res.rows.slice(0, limit).map(aiMemoryFromRow),
        truncated: res.rows.length > limit
      };
    });
  }

  public async createExplicit(
    userId: string,
    input: CreateAiMemoryInput,
    maxActive: number
  ): Promise<AiMemoryCreateResult> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    // A failed BEGIN or ROLLBACK may leave an uncertain connection: discard it.
    let discardClient = true;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      discardClient = false;
      // Locks the account's settings row, so concurrent saves of one account
      // run one after another and the count below cannot be passed twice.
      const settings = await client.query<{
        memory_enabled: boolean;
        explicit_memory_enabled: boolean;
      }>(
        `SELECT s.memory_enabled, s.explicit_memory_enabled
         FROM ai_user_settings s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = $1 AND u.status = 'active'
         FOR UPDATE OF s`,
        [userId]
      );
      const switches = settings.rows[0];
      if (!switches?.memory_enabled || !switches.explicit_memory_enabled) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { available: true, outcome: 'disabled' };
      }
      const counted = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ai_memory_items
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      if ((counted.rows[0]?.n ?? 0) >= maxActive) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return { available: true, outcome: 'limit' };
      }
      const inserted = await client.query<AiMemoryRow>(
        `INSERT INTO ai_memory_items (user_id, kind, content, source, status)
         VALUES ($1, $2, $3, 'explicit', 'active')
         RETURNING ${AI_MEMORY_COLUMNS}`,
        [userId, input.kind, input.content]
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return { available: true, outcome: 'created', item: aiMemoryFromRow(inserted.rows[0]!) };
    } catch (err) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
        }
      }
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return unavailable;
      }
      throw err;
    } finally {
      client.release(discardClient);
    }
  }

  public async update(
    userId: string,
    id: string,
    patch: UpdateAiMemoryInput
  ): Promise<AiMemoryUpdateResult> {
    return this.guard(async () => {
      const res = await this.pool.query<AiMemoryRow>(
        `UPDATE ai_memory_items
         SET kind = COALESCE($3::text, kind),
             content = COALESCE($4::text, content),
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status <> 'dismissed'
         RETURNING ${AI_MEMORY_COLUMNS}`,
        [id, userId, patch.kind ?? null, patch.content ?? null]
      );
      const row = res.rows[0];
      return { available: true as const, item: row ? aiMemoryFromRow(row) : null };
    });
  }

  public async remove(userId: string, id: string): Promise<AiMemoryDeleteResult> {
    return this.guard(async () => {
      const res = await this.pool.query(
        'DELETE FROM ai_memory_items WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      return { available: true as const, deleted: res.rowCount ?? 0 };
    });
  }

  public async removeAll(userId: string): Promise<AiMemoryDeleteResult> {
    return this.guard(async () => {
      const res = await this.pool.query('DELETE FROM ai_memory_items WHERE user_id = $1', [userId]);
      return { available: true as const, deleted: res.rowCount ?? 0 };
    });
  }

  public async listForContext(userId: string, limit: number): Promise<AiMemoryContextResult> {
    return this.guard(async () => {
      const res = await this.pool.query<{ kind: string; content: string }>(
        `SELECT kind, content FROM ai_memory_items
         WHERE user_id = $1 AND status = 'active'
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY updated_at DESC, id DESC
         LIMIT $2`,
        [userId, limit]
      );
      return {
        available: true as const,
        items: res.rows.map((row) => ({ kind: row.kind as AiMemoryKind, content: row.content }))
      };
    });
  }

  private async guard<T>(work: () => Promise<T>): Promise<T | AiMemoriesUnavailable> {
    try {
      return await work();
    } catch (err) {
      if (isMissingSchemaObject(err)) {
        noteUnavailable();
        return unavailable;
      }
      throw err;
    }
  }
}
