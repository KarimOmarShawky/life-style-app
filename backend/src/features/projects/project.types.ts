/**
 * Project domain types.
 *
 * `ProjectRecord` mirrors the database row; `ProjectResponse` is what a client
 * sees. They are separate types rather than one shared shape so that adding an
 * internal column cannot silently publish it (spec section 35).
 */
export interface ProjectRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A project plus counts the list view needs, computed in SQL. */
export interface ProjectWithStats extends ProjectRecord {
  readonly taskCount: number;
  readonly openTaskCount: number;
}

export interface ProjectResponse {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly taskCount: number;
  readonly openTaskCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly description?: string | null | undefined;
}

export interface UpdateProjectInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
}
