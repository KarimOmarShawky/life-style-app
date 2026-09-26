/**
 * Per-request context propagated without threading arguments through every call.
 *
 * Spec section 27 requires one correlation id to tie together the whole path of
 * a request: middleware, controller, service, repository, and any error. Passing
 * that id down manually would mean a `requestId` parameter on every function,
 * including ones with no other reason to know about HTTP.
 *
 * AsyncLocalStorage carries it implicitly instead. The store is established once
 * per request and is readable from any function invoked within it, across await
 * boundaries, with no shared mutable global.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  /** Present only after authentication middleware has run. */
  userId?: string;
  /** Route pattern, e.g. `POST /api/v1/auth/login`. Set once matched. */
  route?: string;
  readonly startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` available to everything it calls. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active context, or undefined outside a request (startup, cron, tests). */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Attaches the authenticated user to the active context so later log lines are
 * attributable. No-op outside a request, which keeps callers free of null checks.
 */
export function setContextUser(userId: string): void {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
}

export function setContextRoute(route: string): void {
  const store = storage.getStore();
  if (store) {
    store.route = route;
  }
}
