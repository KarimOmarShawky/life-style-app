/**
 * Note business logic.
 *
 * This is the first feature that spans both databases, so it carries the rules
 * that make that safe:
 *
 *   1. MongoDB is OPTIONAL in development and required in production. When it is
 *      absent, these endpoints answer 503 and the rest of the API keeps working.
 *      Letting the request through would surface a driver timeout as a 500.
 *   2. A link to a project or task is accepted only if that row exists and
 *      belongs to the caller. Rejected as 422, with a message that is identical
 *      whether the row is missing or someone else's, so it cannot be used to
 *      probe for valid ids.
 *   3. A link whose row has since been deleted reads as null. Nothing across the
 *      boundary is transactional and this code does not pretend otherwise
 *      (decisions DD-002 and DD-003).
 */
import { AppError } from '@/core/errors';
import { createLogger } from '@/core/logger';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';
import { isMongoConnected } from '@/infrastructure/database/mongodb/connection';

import * as references from './note.references';
import * as repository from './note.repository';
import { toNoteResponse } from './note.mapper';
import type {
  CreateNoteInput,
  LinkResolution,
  NoteFilters,
  NoteRecord,
  NoteResponse,
  ReconcileResult,
  UpdateNoteInput,
} from './note.types';

const log = createLogger('note.service');

export class NoteService {
  /**
   * Fails fast when MongoDB is unavailable.
   *
   * 503 with a Retry-After is the honest answer: the request is valid and would
   * succeed later. A 500 would tell the client to stop retrying, and waiting for
   * the driver's server-selection timeout would hold the connection open for
   * several seconds first.
   */
  private assertAvailable(): void {
    if (!isMongoConnected()) {
      throw AppError.serviceUnavailable('MongoDB');
    }
  }

  /** Validates a link supplied in a request body. Absent and null are both fine. */
  private async assertLinksUsable(
    userId: string,
    input: { projectId?: string | null | undefined; taskId?: string | null | undefined },
  ): Promise<void> {
    if (typeof input.projectId === 'string') {
      const usable = await references.projectBelongsToUser(userId, input.projectId);
      if (!usable) {
        throw AppError.validation([
          { field: 'projectId', message: 'projectId does not refer to one of your projects' },
        ]);
      }
    }

    if (typeof input.taskId === 'string') {
      const usable = await references.taskBelongsToUser(userId, input.taskId);
      if (!usable) {
        throw AppError.validation([
          { field: 'taskId', message: 'taskId does not refer to one of your tasks' },
        ]);
      }
    }
  }

  /**
   * Resolves every link on a page in two queries.
   *
   * One query per note would make a 100-note page cost 200 round trips to a
   * database in another region. Duplicated ids collapse into one lookup.
   */
  private async resolveLinks(
    userId: string,
    records: readonly NoteRecord[],
  ): Promise<LinkResolution> {
    const projectIds = [
      ...new Set(records.map((note) => note.projectId).filter((id): id is string => id !== null)),
    ];
    const taskIds = [
      ...new Set(records.map((note) => note.taskId).filter((id): id is string => id !== null)),
    ];

    const [projects, tasks] = await Promise.all([
      references.existingProjectIds(userId, projectIds),
      references.existingTaskIds(userId, taskIds),
    ]);

    return { projects, tasks };
  }

  public async create(userId: string, input: CreateNoteInput): Promise<NoteResponse> {
    this.assertAvailable();
    await this.assertLinksUsable(userId, input);

    const note = await repository.insertNote(userId, input);

    // Links were just validated, so they need no resolution pass.
    return toNoteResponse(note);
  }

  public async getById(userId: string, noteId: string): Promise<NoteResponse> {
    this.assertAvailable();
    repository.assertValidNoteId(noteId);

    const note = await repository.findNoteById(userId, noteId);
    if (!note) {
      // Identical to a note that never existed, which is what stops id
      // enumeration (decision DD-009).
      throw AppError.notFound('Note', { requestedId: noteId, requestedBy: userId });
    }

    return toNoteResponse(note, await this.resolveLinks(userId, [note]));
  }

  public async list(
    userId: string,
    page: PageRequest,
    filters: NoteFilters,
  ): Promise<Page<NoteResponse>> {
    this.assertAvailable();

    const rows = await repository.listNotes(userId, page.limit, page.cursor, filters);
    const paged = buildPage(rows, page.limit);
    const links = await this.resolveLinks(userId, paged.items);

    return {
      items: paged.items.map((note) => toNoteResponse(note, links)),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    noteId: string,
    input: UpdateNoteInput,
  ): Promise<NoteResponse> {
    this.assertAvailable();
    repository.assertValidNoteId(noteId);
    await this.assertLinksUsable(userId, input);

    const updated = await repository.updateNote(userId, noteId, input);
    if (!updated) {
      throw AppError.notFound('Note', { requestedId: noteId, requestedBy: userId });
    }

    // A link the caller did not touch may still be stale, so this path resolves
    // rather than trusting what is stored.
    return toNoteResponse(updated, await this.resolveLinks(userId, [updated]));
  }

  public async remove(userId: string, noteId: string): Promise<void> {
    this.assertAvailable();
    repository.assertValidNoteId(noteId);

    const deleted = await repository.deleteNote(userId, noteId);
    if (!deleted) {
      throw AppError.notFound('Note', { requestedId: noteId, requestedBy: userId });
    }
  }

  public async listTags(userId: string): Promise<readonly string[]> {
    this.assertAvailable();
    return repository.listDistinctTags(userId);
  }

  /**
   * Clears links whose PostgreSQL rows are gone (spec section 8).
   *
   * The counterpart to the tolerant read: reads hide a dangling link, this
   * removes it. Scoped to one user so it can run on demand for one account as
   * well as on a schedule for all of them, which is how the reminder job runner
   * will call it once that exists.
   */
  public async reconcileLinks(userId: string): Promise<ReconcileResult> {
    this.assertAvailable();

    const { projectIds, taskIds } = await repository.linkedReferenceIds(userId);
    const [projects, tasks] = await Promise.all([
      references.existingProjectIds(userId, projectIds),
      references.existingTaskIds(userId, taskIds),
    ]);

    const missingProjectIds = projectIds.filter((id) => !projects.has(id));
    const missingTaskIds = taskIds.filter((id) => !tasks.has(id));

    const result = await repository.clearDanglingLinks(userId, missingProjectIds, missingTaskIds);

    if (result.projectLinksCleared > 0 || result.taskLinksCleared > 0) {
      log.info(
        {
          userId,
          projectLinksCleared: result.projectLinksCleared,
          taskLinksCleared: result.taskLinksCleared,
        },
        'Cleared dangling note links',
      );
    }

    return result;
  }
}
