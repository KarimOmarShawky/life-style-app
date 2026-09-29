'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-provider';
import { AUTH_ROUTES } from '@/lib/config/routes';
import { Spinner } from '@/components/ui/spinner';

/**
 * Client-side auth guard for the workspace. Private user data is only ever
 * rendered in the browser after sign-in; SSR always sees the loading state.
 * A reload starts with an empty in-memory session (intentional) and lands on
 * the sign-in page.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      const next = typeof window !== 'undefined' ? window.location.pathname : '/';
      const query = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
      router.replace(`${AUTH_ROUTES.login}${query}`);
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm" role="status">
          {status === 'loading' ? 'Loading your workspace…' : 'Redirecting to sign-in…'}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Link helper re-exported for auth pages. */
export function AuthLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}

export { useSearchParams };
