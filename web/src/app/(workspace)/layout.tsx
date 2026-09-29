'use client';

import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { AuthGuard } from '@/components/app-shell/auth-guard';

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </AuthGuard>
  );
}
