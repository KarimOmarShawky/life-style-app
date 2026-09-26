/**
 * Expense business logic.
 *
 * Thin by design: the interesting correctness in this slice is in the SQL, which
 * is where the decimal arithmetic and the per-currency grouping live. What is
 * left here is the range policy for reports and the usual not-found handling.
 */
import { AppError } from '@/core/errors';
import { buildPageWith, type Page, type PageRequest } from '@/core/utils/pagination';

import * as repository from './expense.repository';
import { toExpenseResponse } from './money.mapper';
import { inclusiveDayCount, monthBounds, serverToday } from './money.dates';
import type {
  CreateExpenseInput,
  ExpenseFilters,
  ExpenseResponse,
  ExpenseSummaryResponse,
  UpdateExpenseInput,
} from './money.types';

/**
 * The widest report this API will produce in one request.
 *
 * A year covers every screen the application has. Leaving it open would let an
 * authenticated client ask for a decade of aggregates in a loop, which costs the
 * database far more than it costs the caller — the asymmetry that makes an
 * unbounded aggregate worth bounding even behind authentication.
 */
export const MAX_SUMMARY_DAYS = 366;

/** The four ways a range can be asked for, resolved to two concrete dates. */
function resolveRange(requested: { from?: string | undefined; to?: string | undefined }): {
  from: string;
  to: string;
} {
  if (requested.from !== undefined && requested.to !== undefined) {
    return { from: requested.from, to: requested.to };
  }
  if (requested.from !== undefined) {
    return { from: requested.from, to: monthBounds(requested.from).to };
  }
  if (requested.to !== undefined) {
    return { from: monthBounds(requested.to).from, to: requested.to };
  }
  return monthBounds(serverToday());
}

export class ExpenseService {
  public async create(userId: string, input: CreateExpenseInput): Promise<ExpenseResponse> {
    const expense = await repository.insertExpense(userId, input);
    return toExpenseResponse(expense);
  }

  public async getById(userId: string, expenseId: string): Promise<ExpenseResponse> {
    const expense = await repository.findExpenseById(userId, expenseId);
    if (!expense) {
      throw AppError.notFound('Expense', { requestedId: expenseId, requestedBy: userId });
    }
    return toExpenseResponse(expense);
  }

  public async list(
    userId: string,
    page: PageRequest,
    filters: ExpenseFilters,
  ): Promise<Page<ExpenseResponse>> {
    const rows = await repository.listExpenses(userId, page.limit, page.cursor, filters);

    // The cursor is built from `spentOn`, which is what the query orders by.
    // Building it from `createdAt` here would produce a cursor that cannot
    // resume this scan, and the failure would look like randomly missing rows
    // rather than an error.
    const paged = buildPageWith(rows, page.limit, (row) => ({
      createdAt: row.spentOn,
      id: row.id,
    }));

    return {
      items: paged.items.map(toExpenseResponse),
      nextCursor: paged.nextCursor,
      hasMore: paged.hasMore,
    };
  }

  public async update(
    userId: string,
    expenseId: string,
    input: UpdateExpenseInput,
  ): Promise<ExpenseResponse> {
    const updated = await repository.updateExpense(userId, expenseId, input);
    if (!updated) {
      throw AppError.notFound('Expense', { requestedId: expenseId, requestedBy: userId });
    }
    return toExpenseResponse(updated);
  }

  public async remove(userId: string, expenseId: string): Promise<void> {
    const deleted = await repository.deleteExpense(userId, expenseId);
    if (!deleted) {
      throw AppError.notFound('Expense', { requestedId: expenseId, requestedBy: userId });
    }
  }

  /**
   * Spending over a range, defaulting to the current month.
   *
   * Either end may be given alone: `from` with no `to` runs to the end of the
   * month `from` falls in, and `to` with no `from` runs from the start of its
   * own month. Defaulting a missing end to today or to the epoch would make the
   * meaning of a one-sided range depend on when it was asked.
   */
  public async summary(
    userId: string,
    requested: { from?: string | undefined; to?: string | undefined },
  ): Promise<ExpenseSummaryResponse> {
    const { from, to } = resolveRange(requested);

    const days = inclusiveDayCount(from, to);
    if (days > MAX_SUMMARY_DAYS) {
      throw AppError.validation([
        { field: 'from', message: `the range must not be longer than ${MAX_SUMMARY_DAYS} days` },
      ]);
    }

    const [totals, byCategory] = await Promise.all([
      repository.totalsByCurrency(userId, from, to),
      repository.totalsByCategory(userId, from, to),
    ]);

    return { from, to, totals, byCategory };
  }
}
