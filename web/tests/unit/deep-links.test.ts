import { describe, expect, it } from 'vitest';
import {
  AUTH_ROUTES,
  WORKSPACE_ROUTES,
  isAuthRoute,
  isWorkspaceRoute,
  safeInternalPath
} from '@/lib/config/routes';

describe('route registry covers every required screen', () => {
  it('auth routes', () => {
    expect(Object.values(AUTH_ROUTES)).toEqual(
      expect.arrayContaining(['/login', '/register', '/forgot-password', '/reset-password'])
    );
  });

  it('workspace routes — verbatim required layout', () => {
    const required = [
      '/',
      '/tasks',
      '/projects',
      '/recurring-tasks',
      '/focus',
      '/habits',
      '/goals',
      '/calendar',
      '/notes',
      '/money/categories',
      '/money/transactions',
      '/money/subscriptions',
      '/money/budgets',
      '/money/reports',
      '/settings'
    ];
    const registered = new Set<string>(Object.values(WORKSPACE_ROUTES));
    for (const path of required) {
      expect(registered.has(path)).toBe(true);
    }
  });

  it('recognises workspace prefixes (deep links)', () => {
    expect(isWorkspaceRoute('/')).toBe(true);
    expect(isWorkspaceRoute('/money/transactions')).toBe(true);
    expect(isWorkspaceRoute('/tasks/22222222-2222-4222-8222-222222222222')).toBe(true);
    expect(isWorkspaceRoute('/login')).toBe(false);
    expect(isWorkspaceRoute('/api/v1/tasks')).toBe(false);
    expect(isWorkspaceRoute('/evil')).toBe(false);
  });

  it('recognises auth routes exactly', () => {
    expect(isAuthRoute('/login')).toBe(true);
    expect(isAuthRoute('/loginx')).toBe(false);
  });
});

describe('safeInternalPath — open-redirect prevention', () => {
  it('accepts plain internal paths', () => {
    expect(safeInternalPath('/tasks')).toBe('/tasks');
    expect(safeInternalPath('/money/reports')).toBe('/money/reports');
    expect(safeInternalPath('/')).toBe('/');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeInternalPath('https://evil.example')).toBeNull();
    expect(safeInternalPath('//evil.example')).toBeNull();
    expect(safeInternalPath('/\\evil.example')).toBeNull();
    expect(safeInternalPath('javascript:alert(1)')).toBeNull();
    expect(safeInternalPath('/evil.example')).toBe('/evil.example'); // still internal
  });

  it('never redirects back into the auth screens (loops)', () => {
    expect(safeInternalPath('/login')).toBeNull();
    expect(safeInternalPath('/register')).toBeNull();
    expect(safeInternalPath('/login?x=1')).toBeNull(); // prefix check
  });

  it('treats empty input as null', () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
    expect(safeInternalPath('')).toBeNull();
  });
});
