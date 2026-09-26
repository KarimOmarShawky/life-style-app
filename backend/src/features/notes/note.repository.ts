/**
 * Note persistence (MongoDB).
 *
 * OWNERSHIP IS IN EVERY FILTER, exactly as it is in every SQL WHERE clause
 * elsewhere (decision DD-008). `userId` appears in every read, every update and
 * every delete, so a request for another user's note matches nothing and becomes
 * a 404 rather than their data.
 *
 * All reads use `.lean()`: a Mongoose document carries change tracking and
 * getters this layer never uses, and returning plain objects keeps the mapper
 * working on data rather than on a live handle to the database.
 */
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '@/core/errors';
import type { Cursor } from '@/core/utils/pagination';
import { NoteModel, type NoteDocument } from '@/infrastructure/database/mongodb/note.model';

import type {
  CreateNoteInput,
  NoteFilters,
  NoteRecord,
  ReconcileResult,
  UpdateNoteInput,
} from './note.types';

/** The fields a lean query returns, before mapping. */
interface LeanNote {
  _id: Types.ObjectId;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  title: string;
  content: string;
  tags: string[];
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(document: LeanNote): NoteRecord {
  return {
    id: document._id.toString(),
    userId: document.userId,
    projectId: document.projectId,
    taskId: document.taskId,
    title: document.title,
    content: document.content,
    tags: document.tags,
    isArchived: document.isArchived,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

/**
 * Escapes a user-supplied search term for use inside a regular expression.
 *
 * Without this, a search for "c++" is a syntax error and a search for "(a+)+$"
 * is a denial of service against our own process. Escaping every metacharacter
 * turns the term back into literal text, which is what a search box means.
 */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the query document.
 *
 * Every branch adds a fixed field name with a validated value. No key is ever
 * taken from client input, which is what keeps operator injection impossible
 * here as well as at the validation layer.
 *
 * Exported so the filter can be asserted on directly. This is the one piece of
 * this file that decides who sees what, and it is worth testing without needing
 * a database to observe it.
 */
export function buildNoteFilter(
  userId: string,
  filters: NoteFilters,
  cursor: Cursor | undefined,
): FilterQuery<NoteDocument> {
  const conditions: FilterQuery<NoteDocument>[] = [];

  if (filters.tag !== undefined) {
    // Matches one element of the array, using the multikey tags index.
    conditions.push({ tags: filters.tag });
  }

  if (filters.projectId !== undefined) {
    conditions.push({ projectId: filters.projectId });
  }

  if (filters.taskId !== undefined) {
    conditions.push({ taskId: filters.taskId });
  }

  if (filters.search !== undefined) {
    const pattern = new RegExp(escapeRegex(filters.search), 'i');
    conditions.push({ $or: [{ title: pattern }, { content: pattern }] });
  }

  if (cursor) {
    // A cursor is base64 of a JSON object, so a client can decode and forge one.
    // That is harmless for ownership, which is applied separately, but an id
    // MongoDB cannot parse would throw inside the driver and surface as a 500.
    // Checked here rather than in decodeCursor, because only this feature uses
    // ObjectIds.
    if (!Types.ObjectId.isValid(cursor.id)) {
      throw AppError.validation([{ field: 'cursor', message: 'cursor is malformed' }]);
    }

    // Keyset predicate on the composite sort key. Two notes created in the same
    // millisecond are separated by the id, so a page boundary can neither skip
    // nor repeat one.
    const createdAt = new Date(cursor.createdAt);
    conditions.push({
      $or: [
        { createdAt: { $lt: createdAt } },
        { createdAt, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ],
    });
  }

  const base: FilterQuery<NoteDocument> = { userId, isArchived: filters.archived };

  // Conditions are combined with $and rather than merged into one object,
  // because search and the cursor each contribute their own $or and merging
  // would let one silently overwrite the other.
  return conditions.length > 0 ? { ...base, $and: conditions } : base;
}

export async function insertNote(userId: string, input: CreateNoteInput): Promise<NoteRecord> {
  const created = await NoteModel.create({
    userId,
    title: input.title,
    content: input.content ?? '',
    tags: input.tags ?? [],
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    isArchived: false,
  });

  return toRecord(created.toObject<LeanNote>());
}

export async function findNoteById(
  userId: string,
  noteId: string,
): Promise<NoteRecord | undefined> {
  const document = await NoteModel.findOne({ _id: new Types.ObjectId(noteId), userId })
    .lean<LeanNote>()
    .exec();

  return document ? toRecord(document) : undefined;
}

/**
 * Lists a user's notes, newest first.
 *
 * Fetches `limit + 1` so the caller can tell whether another page exists without
 * a second count, which on MongoDB means a full scan of the matching set.
 */
export async function listNotes(
  userId: string,
  limit: number,
  cursor: Cursor | undefined,
  filters: NoteFilters,
): Promise<NoteRecord[]> {
  const documents = await NoteModel.find(buildNoteFilter(userId, filters, cursor))
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<LeanNote[]>()
    .exec();

  return documents.map(toRecord);
}

/**
 * Applies a partial update.
 *
 * Only supplied fields are written. `projectId` and `taskId` accept null to
 * unlink, which is why absent and null cannot be collapsed into one case.
 * `runValidators` is on so the schema's length and pattern rules apply to
 * updates as well as inserts; without it they guard inserts only.
 */
export async function updateNote(
  userId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<NoteRecord | undefined> {
  const changes: Record<string, unknown> = {};

  if (input.title !== undefined) {
    changes['title'] = input.title;
  }
  if (input.content !== undefined) {
    changes['content'] = input.content;
  }
  if (input.tags !== undefined) {
    changes['tags'] = [...input.tags];
  }
  if (input.projectId !== undefined) {
    changes['projectId'] = input.projectId;
  }
  if (input.taskId !== undefined) {
    changes['taskId'] = input.taskId;
  }
  if (input.isArchived !== undefined) {
    changes['isArchived'] = input.isArchived;
  }

  if (Object.keys(changes).length === 0) {
    // Validation rejects an empty patch, so reaching here means a caller built
    // one in code. Returning the unchanged note is friendlier than an update
    // with no $set, which MongoDB rejects outright.
    return findNoteById(userId, noteId);
  }

  const document = await NoteModel.findOneAndUpdate(
    { _id: new Types.ObjectId(noteId), userId },
    { $set: changes },
    { new: true, runValidators: true },
  )
    .lean<LeanNote>()
    .exec();

  return document ? toRecord(document) : undefined;
}

export async function deleteNote(userId: string, noteId: string): Promise<boolean> {
  const result = await NoteModel.deleteOne({ _id: new Types.ObjectId(noteId), userId }).exec();
  return result.deletedCount > 0;
}

/** Every distinct tag this user has used, for a filter menu (FR-12). */
export async function listDistinctTags(userId: string): Promise<string[]> {
  const tags = await NoteModel.distinct('tags', { userId }).exec();
  return (tags as string[]).sort((a, b) => a.localeCompare(b));
}

/** Ids currently linked by this user's notes, used to drive reconciliation. */
export async function linkedReferenceIds(
  userId: string,
): Promise<{ projectIds: string[]; taskIds: string[] }> {
  const [projectIds, taskIds] = await Promise.all([
    NoteModel.distinct('projectId', { userId, projectId: { $ne: null } }).exec(),
    NoteModel.distinct('taskId', { userId, taskId: { $ne: null } }).exec(),
  ]);

  return { projectIds: projectIds as string[], taskIds: taskIds as string[] };
}

/**
 * Clears links whose PostgreSQL rows are gone.
 *
 * Deliberately not run on the read path: a read tolerates a dangling link by
 * reporting it as null, and a write during a GET would turn a read-heavy
 * endpoint into a write-heavy one.
 */
export async function clearDanglingLinks(
  userId: string,
  missingProjectIds: readonly string[],
  missingTaskIds: readonly string[],
): Promise<ReconcileResult> {
  let projectLinksCleared = 0;
  let taskLinksCleared = 0;

  if (missingProjectIds.length > 0) {
    const result = await NoteModel.updateMany(
      { userId, projectId: { $in: [...missingProjectIds] } },
      { $set: { projectId: null } },
    ).exec();
    projectLinksCleared = result.modifiedCount;
  }

  if (missingTaskIds.length > 0) {
    const result = await NoteModel.updateMany(
      { userId, taskId: { $in: [...missingTaskIds] } },
      { $set: { taskId: null } },
    ).exec();
    taskLinksCleared = result.modifiedCount;
  }

  return { projectLinksCleared, taskLinksCleared };
}

/**
 * Rejects an id MongoDB cannot parse.
 *
 * Route validation already enforces the 24-hex shape, so this is the guard for
 * any other call path. Constructing an ObjectId from bad input throws a driver
 * error that would otherwise surface as a 500.
 */
export function assertValidNoteId(noteId: string): void {
  if (!Types.ObjectId.isValid(noteId)) {
    throw AppError.notFound('Note', { requestedId: noteId });
  }
}
