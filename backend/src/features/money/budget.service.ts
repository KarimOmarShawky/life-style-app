/**
 * Budget business logic.
 *
 * Two things happen here that the repository deliberately does not do.
 *
 * The month is widened from `YYYY-MM` to the first day of that month before it
 * reaches SQL. The column is a DATE with a CHECK that the day is the 1st, so
 * passing a client's date through unchanged would turn a typo into a 500 from a
 * constraint. Narrowing at the edge means the constraint can never be the thing
 * that reports the error.
 *
 * A duplicate budget becomes a 409 rather than a 500. One budget per category
 * per month is enforced by a unique index, which is the only thing that holds
 * under two concurrent creates; a check-then-insert would let both through. The
 * index is therefore the rule, and this layer only translates its violation into
 * an answer the client can act on.
 */
import { AppError, ErrorCode } from '@/core/errors';
import { buildPage, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './budget.repository';
import { toBudgetResponse } from './money.mapper';
import { monthToFirstDay } from './money.dates';
import type { BudgetResponse, CreateBudgetInput, UpdateBudgetInput } from './money.types';

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === UNIQUE_VIOLATION;
}

export class BudgetService {
  private duplicate(metadata: Readonly<Record<string, unknown>>): AppError {
    return new AppError(ErrorCode.ALREADY_EXISTS, {
      message: 'A budget for that category already exists in that month.',
      metadata,
    });
  }

  public async create(userId: string, input: CreateBudgetInput): Promise<BudgetResponse> {
    try {
      const budget = await repository.insertBudget(userId, {
        ...input,
        month: monthToFirstDay(input.month),
      });
      return toBudgetResponse(budget);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.duplicate({ category: input.category, month: input.month });
      }
      throw error;
    }
  }

  public async getById(userId: string, budgetId: string): Promise<BudgetResponse> {
    const budget = await repository.findBudgetById(userId, budgetId);
    if (!budget) {
      throw AppError.notFound('Budget', { requestedId: budgetId, requestedBy: userId });
    }
    return toBudgetResponse(budget);
  }

  public async list(
    userId: string,
    page: PageRequest,
    month: string | undefined,
  ): Promise<Page<BudgetResponse>> {
    const rows = await repository.listBudgets(
      userId,
      page.limit,
      page.cursor,
      month === undefined ? undefined : monthToFirstDay(month),
    );
    const paged = buildPage(rows, page.limit);

    return {
      items: paged.items.map(toBudgetResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    budgetId: string,
    input: UpdateBudgetInput,
  ): Promise<BudgetResponse> {
    const widened: UpdateBudgetInput =
      input.month === undefined ? input : { ...input, month: monthToFirstDay(input.month) };

    try {
      const updated = await repository.updateBudget(userId, budgetId, widened);
      if (!updated) {
        throw AppError.notFound('Budget', { requestedId: budgetId, requestedBy: userId });
      }
      return toBudgetResponse(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw this.duplicate({ budgetId, category: input.category, month: input.month });
      }
      throw error;
    }
  }

  public async remove(userId: string, budgetId: string): Promise<void> {
    const deleted = await repository.deleteBudget(userId, budgetId);
    if (!deleted) {
      throw AppError.notFound('Budget', { requestedId: budgetId, requestedBy: userId });
    }
  }
}
