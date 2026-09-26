/**
 * Note document (ERD: Note).
 *
 * WHY THIS ONE LIVES IN MONGODB
 *
 * A note is the only entity in the model whose shape varies per row. Its body is
 * free-form and unbounded, its tags are a set of arbitrary length, and the
 * roadmap adds attachments and rich content blocks to it later. Representing
 * that relationally means either a `note_tags` join table plus a `note_blocks`
 * table, so that reading one note costs three joins, or a JSONB column, which is
 * a document store with extra steps.
 *
 * CROSS-DATABASE REFERENCES
 *
 * `userId`, `projectId` and `taskId` point at PostgreSQL rows. There is no
 * foreign key across that boundary and there cannot be one, so:
 *
 *   - The service validates that a referenced task or project exists AND belongs
 *     to the caller before writing. That check is also the ownership check, so
 *     a note cannot be attached to someone else's task (spec section 16).
 *   - Deleting a task does not cascade here. A reconciliation job clears stale
 *     links, and reads tolerate a dangling link by treating it as unlinked.
 *
 * This is the deliberate synchronization strategy spec section 8 requires, and
 * the honest trade-off for putting notes here.
 */
import mongoose, { Schema, model, type Document, type Model } from 'mongoose';

export interface NoteDocument extends Document {
  /** PostgreSQL users.id. Every query must filter on it. */
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

/** RFC 4122 shape, matching the UUIDs PostgreSQL generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noteSchema = new Schema<NoteDocument>(
  {
    userId: {
      type: String,
      required: true,
      match: [UUID_PATTERN, 'userId must be a UUID'],
    },
    projectId: {
      type: String,
      default: null,
      match: [UUID_PATTERN, 'projectId must be a UUID'],
    },
    taskId: {
      type: String,
      default: null,
      match: [UUID_PATTERN, 'taskId must be a UUID'],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'title must be at most 200 characters'],
    },
    content: {
      type: String,
      default: '',
      maxlength: [100_000, 'content must be at most 100000 characters'],
    },
    tags: {
      type: [String],
      default: [],
      validate: [
        {
          validator: (tags: string[]): boolean => tags.length <= 25,
          message: 'a note may have at most 25 tags',
        },
        {
          validator: (tags: string[]): boolean =>
            tags.every((tag) => tag.length > 0 && tag.length <= 40),
          message: 'each tag must be between 1 and 40 characters',
        },
      ],
    },
    isArchived: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    // Rejects any field not declared above, so an injected property is an error
    // rather than a silently stored document.
    strict: 'throw',
    versionKey: false,
    collection: 'notes',
  },
);

// THE list index. Every listing is "this user's notes, archived or not, newest
// first", so all three fields are present in every query and in this order.
// Leading with userId is what makes it usable for the mandatory ownership
// filter; a listing that could not use it would scan the whole collection.
noteSchema.index({ userId: 1, isArchived: 1, createdAt: -1 });

// Tag filtering within one user's notes (FR-12). A multikey index: MongoDB
// indexes each array element, so this serves "notes tagged X" directly.
noteSchema.index({ userId: 1, tags: 1 });

// Resolving "notes attached to this task" without scanning. Scoped by userId
// like everything else: an index on taskId alone would be reachable only by a
// query that omits the owner filter, which no query here is allowed to do.
noteSchema.index({ userId: 1, taskId: 1 }, { sparse: true });
noteSchema.index({ userId: 1, projectId: 1 }, { sparse: true });

// NO TEXT INDEX. Search is a case-insensitive substring match (see
// note.repository.ts), because a notes search box is expected to match "proj"
// against "project" and a $text index does not: it matches whole stemmed words.
// An index nothing queries still costs write latency and memory, so it is not
// carried here. Decision DD-016 records what to change if ranked full-text
// search is wanted later.

/** Reuses an already-compiled model; see the note in audit-log.model.ts. */
export const NoteModel: Model<NoteDocument> =
  (mongoose.models['Note'] as Model<NoteDocument> | undefined) ??
  model<NoteDocument>('Note', noteSchema);
