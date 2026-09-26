/**
 * src/features/projects/projects.service.ts
 *
 * Implements Section 1.4.4 & 14.5: Projects Service.
 */

import { AppError } from '../../core/errors/app-error.js';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { Kysely } from 'kysely';
import type { ProjectsRepository } from './projects.repository.js';
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ListProjectsQuery
} from './projects.validation.js';
import type { ProjectDto, ProjectStatus } from './projects.types.js';
import { toProjectDto } from './projects.dto.js';

export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly db: Kysely<DatabaseSchema>
  ) {}

  private async verifyGoalOwnership(userId: string, goalId: string): Promise<void> {
    const goal = await this.db
      .selectFrom('goals')
      .select(['id'])
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (!goal) {
      throw AppError.notFound('Goal not found');
    }
  }

  async createProject(userId: string, input: CreateProjectInput): Promise<ProjectDto> {
    if (input.goalId) {
      await this.verifyGoalOwnership(userId, input.goalId);
    }

    const project = await this.projectsRepository.create({
      userId,
      name: input.name,
      description: input.description,
      status: input.status,
      color: input.color,
      goalId: input.goalId,
      dueDate: input.dueDate
    });

    return toProjectDto(project, { open: 0, done: 0 });
  }

  async getProject(userId: string, id: string): Promise<ProjectDto> {
    const project = await this.projectsRepository.findActiveById(userId, id);
    if (!project) {
      throw AppError.notFound('Project not found');
    }

    const counts = await this.projectsRepository.getTaskCounts(userId, [id]);
    return toProjectDto(project, counts.get(id));
  }

  async updateProject(userId: string, id: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const existing = await this.projectsRepository.findActiveById(userId, id);
    if (!existing) {
      throw AppError.notFound('Project not found');
    }

    if (input.goalId) {
      await this.verifyGoalOwnership(userId, input.goalId);
    }

    const updated = await this.projectsRepository.update(
      userId,
      id,
      {
        name: input.name,
        description: input.description,
        status: input.status,
        color: input.color,
        goalId: input.goalId,
        dueDate: input.dueDate
      },
      input.version
    );

    if (!updated) {
      throw AppError.conflict('VERSION_CONFLICT', 'Conflict: Project was modified concurrently');
    }

    const counts = await this.projectsRepository.getTaskCounts(userId, [id]);
    return toProjectDto(updated, counts.get(id));
  }

  async deleteProject(userId: string, id: string, cascade = false): Promise<void> {
    const deleted = await this.projectsRepository.softDelete(userId, id, cascade);
    if (!deleted) {
      throw AppError.notFound('Project not found');
    }
  }

  async restoreProject(userId: string, id: string): Promise<ProjectDto> {
    const restored = await this.projectsRepository.restore(userId, id, 30);
    if (!restored) {
      throw AppError.notFound('Project not found or restore window expired');
    }

    const counts = await this.projectsRepository.getTaskCounts(userId, [id]);
    return toProjectDto(restored, counts.get(id));
  }

  async listProjects(
    userId: string,
    query: ListProjectsQuery
  ): Promise<{ data: ProjectDto[]; meta: { nextCursor: string | null } }> {
    let statuses: ProjectStatus[] | undefined;
    if (query.status) {
      statuses = query.status.split(',').map((s) => s.trim()) as ProjectStatus[];
    }

    const { projects, nextCursor } = await this.projectsRepository.list(
      userId,
      statuses,
      query.limit,
      query.cursor
    );

    const projectIds = projects.map((p) => p.id);
    const counts = await this.projectsRepository.getTaskCounts(userId, projectIds);

    const data = projects.map((p) => toProjectDto(p, counts.get(p.id)));

    return {
      data,
      meta: { nextCursor }
    };
  }
}
