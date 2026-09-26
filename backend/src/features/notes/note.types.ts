/**
 * Note domain types.
 *
 * `NoteRecord` mirrors the stored document; `NoteResponse` is what a client
 * sees. Kept separate for the same reason as every other feature: adding an
 * internal field to storage must not silently publish it (spec section 35).
 */

/** A note as stored, with the MongoDB ObjectId already narrowed to a string. */
export interface NoteRecord {
  readonly id: string;
  readonly userId: string;
  /** PostgreSQL projects.id. May point at a row that no longer exists. */
  readonly projectId: string | null;
  /** PostgreSQL tasks.id. May point at a row that no longer exists. */
  readonly taskId: string | null;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Which referenced PostgreSQL rows were confirmed to exist.
 *
 * There is no foreign key across the database boundary, so a link can outlive
 * its target. Reads resolve links against PostgreSQL and treat an unresolved one
 * as unlinked rather than returning an id the client cannot fetch
 * (decision DD-003).
 */
export interface LinkResolution {
  readonly projects: ReadonlySet<string>;
  readonly tasks: ReadonlySet<string>;
}

export interface NoteResponse {
  readonly id: string;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateNoteInput {
  readonly title: string;
  readonly content?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly projectId?: string | null | undefined;
  readonly taskId?: string | null | undefined;
}

export interface UpdateNoteInput {
  readonly title?: string | undefined;
  readonly content?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly projectId?: string | null | undefined;
  readonly taskId?: string | null | undefined;
  readonly isArchived?: boolean | undefined;
}

export interface NoteFilters {
  /** Exact tag match, already lowercased by validation. */
  readonly tag?: string | undefined;
  /** Case-insensitive substring of title or content. */
  readonly search?: string | undefined;
  readonly projectId?: string | undefined;
  readonly taskId?: string | undefined;
  /**
   * Archived notes and live notes are never mixed in one listing. Defaults to
   * false, so archiving genuinely gets a note out of the way.
   */
  readonly archived: boolean;
}

/** Result of clearing links whose PostgreSQL rows are gone. */
export interface ReconcileResult {
  readonly projectLinksCleared: number;
  readonly taskLinksCleared: number;
}
