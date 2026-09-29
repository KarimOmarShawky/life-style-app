'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth/auth-provider';
import { QueryProvider } from './query-provider';
import { ToastProvider } from './toast-provider';

/** Client-side application providers: auth (memory-only) → queries → toasts. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <QueryProvider>
        <ToastProvider>{children}</ToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
