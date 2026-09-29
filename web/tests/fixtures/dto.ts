/**
 * Fixtures derived 1:1 from backend DTO mappers (tasks.dto.ts, money.dto.ts,
 * notes dto, …). Every field here exists in the runtime contract — nothing is
 * invented. Kept in one place so integration tests exercise realistic shapes.
 */

import type { Task, Transaction, Category, NoteListItem, Project, UserDto } from '@/types/api';

export const userFixture: UserDto = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'demo@example.test',
  displayName: 'Demo User',
  timezone: 'America/New_York',
  locale: 'en',
  weekStart: 1,
  defaultCurrency: 'USD',
  pushShowTitles: true,
  status: 'active',
  emailVerified: true,
  createdAt: '2026-01-15T12:00:00.000Z'
};

export const taskFixture: Task = {
  id: '22222222-2222-4222-8222-222222222222',
  userId: userFixture.id,
  title: 'Write quarterly report',
  description: null,
  status: 'todo',
  priority: 'high',
  projectId: null,
  dueDate: '2026-09-30',
  dueTime: '17:00',
  plannedDate: null,
  isFocus: false,
  completedAt: null,
  createdAt: '2026-09-20T09:00:00.000Z',
  updatedAt: '2026-09-21T10:30:00.000Z',
  version: 3
} as Task;

export const taskListFixture = {
  data: [
    taskFixture,
    {
      ...taskFixture,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Book dentist',
      status: 'in_progress' as const,
      priority: 'medium' as const,
      dueDate: '2026-09-28',
      dueTime: null,
      version: 1
    }
  ],
  meta: { limit: 25, hasMore: true, nextCursor: 'cursor-abc' }
};

export const projectFixture: Project = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Home renovation',
  description: null,
  status: 'active',
  color: null,
  goalId: null,
  dueDate: null,
  createdAt: '2026-05-01T08:00:00.000Z',
  updatedAt: '2026-05-02T08:00:00.000Z',
  version: 1,
  taskCounts: { open: 3, done: 1 }
};

export const categoryFixture: Category = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'expense',
  name: 'Groceries',
  icon: null,
  color: '#315C4C',
  archived: false,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  version: 1
};

export const transactionFixture: Transaction = {
  id: '66666666-6666-4666-8666-666666666666',
  kind: 'expense',
  amount: '1234.56',
  currency: 'USD',
  occurredOn: '2026-09-21',
  categoryId: categoryFixture.id,
  description: 'Weekly groceries',
  merchant: 'Market Street Co-op',
  subscriptionId: null,
  billingDate: null,
  source: 'manual',
  createdAt: '2026-09-21T18:00:00.000Z',
  updatedAt: '2026-09-21T18:00:00.000Z',
  version: 1
};

export const noteFixture: NoteListItem = {
  id: '77777777-7777-4777-8777-777777777777',
  userId: userFixture.id,
  title: 'Gift ideas',
  excerpt: 'Ideas for the family trip gifts…',
  tags: ['family'],
  isPinned: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  deletedAt: null,
  version: 2
};

export const tokenPairFixture = {
  accessToken: 'header.payload.signature',
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  refreshToken: 'refresh-token-value',
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
};

export function envelopeError(code: string, message = 'boom', details?: unknown): string {
  return JSON.stringify({
    success: false,
    error: { code, message, requestId: 'req-test-1', ...(details ? { details } : {}) }
  });
}
