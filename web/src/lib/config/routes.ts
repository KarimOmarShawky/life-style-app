/**
 * Central route registry (deep links) used by navigation, guards, and tests.
 */

export const AUTH_ROUTES = {
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password'
} as const;

export const WORKSPACE_ROUTES = {
  today: '/',
  tasks: '/tasks',
  projects: '/projects',
  recurringTasks: '/recurring-tasks',
  focus: '/focus',
  habits: '/habits',
  goals: '/goals',
  calendar: '/calendar',
  notes: '/notes',
  money: '/money',
  moneyCategories: '/money/categories',
  moneyTransactions: '/money/transactions',
  moneySubscriptions: '/money/subscriptions',
  moneyBudgets: '/money/budgets',
  moneyReports: '/money/reports',
  settings: '/settings'
} as const;

export type WorkspaceRouteKey = keyof typeof WORKSPACE_ROUTES;

export function isAuthRoute(pathname: string): boolean {
  return (Object.values(AUTH_ROUTES) as string[]).includes(pathname);
}

export function isWorkspaceRoute(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname.startsWith('/tasks') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/recurring-tasks') ||
    pathname.startsWith('/focus') ||
    pathname.startsWith('/habits') ||
    pathname.startsWith('/goals') ||
    pathname.startsWith('/calendar') ||
    pathname.startsWith('/notes') ||
    pathname.startsWith('/money') ||
    pathname.startsWith('/settings')
  );
}

/**
 * Sanitizes a `?next=` redirect target so it can only be an internal
 * application path (never a protocol-relative or absolute URL).
 */
export function safeInternalPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.startsWith('/login') || next.startsWith('/register')) return null;
  return next;
}
