/**
 * Project business logic.
 *
 * Thin by nature: projects are a grouping construct with few rules. The rules
 * that do exist are the interesting part of this file.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './project.repository';
import { toProjectResponse } from './project.mapper';
import type { CreateProjectInput, ProjectResponse, UpdateProjectInput } from './project.types';

export class ProjectService {
  /**
   * Creates a project.
   *
   * Name uniqueness per user is enforced by a unique index, not by a preceding
   * SELECT. Two concurrent creates would both pass a check-then-insert; only one
   * can win against the index (spec section 32).
   */
  public async create(userId: string, input: CreateProjectInput): Promise<ProjectResponse> {
    try {
      const project = await repository.insertProject(userId, input);
      return toProjectResponse(project);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(ErrorCode.ALREADY_EXISTS, {
          message: 'You already have a project with this name.',
          metadata: { name: input.name },
        });
      }
      throw error;
    }
  }

  /**
   * Fetches one project.
   *
   * The repository query already filters on `user_id`, so another user's project
   * comes back as undefined and becomes a 404. That is the same response as a
   * genuinely missing project, which is what prevents id enumeration
   * (decision DD-009).
   */
  public async getById(userId: string, projectId: string): Promise<ProjectResponse> {
    const project = await repository.findProjectById(userId, projectId);
    if (!project) {
      throw AppError.notFound('Project', { requestedId: projectId, requestedBy: userId });
    }
    return toProjectResponse(project);
  }

  public async list(userId: string, page: PageRequest): Promise<Page<ProjectResponse>> {
    const rows = await repository.listProjects(userId, page.limit, page.cursor);

    // Paging is computed on the database records, which still carry the real
    // `createdAt` Date needed to build a cursor, before mapping to responses.
    const paged = buildPage(rows, page.limit);

    return {
      items: paged.items.map(toProjectResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectResponse> {
    try {
      const updated = await repository.updateProject(userId, projectId, input);
      if (!updated) {
        throw AppError.notFound('Project', { requestedId: projectId, requestedBy: userId });
      }
      return toProjectResponse(updated);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(ErrorCode.ALREADY_EXISTS, {
          message: 'You already have a project with this name.',
        });
      }
      throw error;
    }
  }

  /**
   * Deletes a project. Its tasks survive and become ungrouped.
   *
   * That behaviour comes from `ON DELETE SET NULL` on `tasks.project_id`, chosen
   * over CASCADE because deleting a container should not destroy its contents.
   */
  public async remove(userId: string, projectId: string): Promise<void> {
    const deleted = await repository.deleteProject(userId, projectId);
    if (!deleted) {
      throw AppError.notFound('Project', { requestedId: projectId, requestedBy: userId });
    }
  }
}
