import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  // Ensure no test leaks credentials into storage between cases.
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Fail loudly if any code path tries to persist to web storage.
const forbiddenWrite = (store: 'localStorage' | 'sessionStorage') =>
  function persistAttempt(): never {
    throw new Error(`Unexpected ${store} write: tokens must stay in memory`);
  };

(window as unknown as { __forbiddenPersist: typeof forbiddenWrite }).__forbiddenPersist =
  forbiddenWrite;
