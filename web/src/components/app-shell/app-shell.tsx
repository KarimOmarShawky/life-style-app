'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SidebarNav } from '@/components/navigation/sidebar-nav';
import { useAuth } from '@/lib/auth/auth-provider';
import { Button } from '@/components/ui/button';

/**
 * App shell: responsive desktop sidebar + compact mobile drawer navigation,
 * top bar with account actions. Private data renders client-side only.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Move focus back to the trigger button when the drawer closes.
  useEffect(() => {
    if (!mobileOpen) {
      const active = document.activeElement;
      if (active === document.body) menuButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <BrandMark />
        </div>
        <SidebarNav />
        <div className="border-t border-border p-3">
          <UserSummary />
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-start text-muted-foreground"
            onClick={handleSignOut}
            loading={signingOut}
          >
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Button
              ref={menuButtonRef}
              variant="ghost"
              size="icon"
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? (
                <X className="size-5" aria-hidden="true" />
              ) : (
                <Menu className="size-5" aria-hidden="true" />
              )}
            </Button>
            <Link href="/" className="flex items-center gap-2">
              <BrandMark compact />
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/settings"
              className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            >
              {user ? initialsOf(user.displayName) : ''}
            </Link>
          </div>
        </header>

        {/* Mobile drawer */}
        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-foreground/35"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface shadow-lg">
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <BrandMark />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close navigation menu"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="size-5" aria-hidden="true" />
                </Button>
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
              <div className="border-t border-border p-3">
                <UserSummary />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full justify-start text-muted-foreground"
                  onClick={handleSignOut}
                  loading={signingOut}
                >
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-on-primary"
      >
        L
      </span>
      {!compact ? (
        <span className="text-sm font-semibold tracking-tight text-foreground">LifeStyle</span>
      ) : null}
    </span>
  );
}

function UserSummary() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-active"
      >
        {initialsOf(user.displayName)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{user.displayName}</p>
        <p className="truncate text-xs text-subtle-foreground">{user.email}</p>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
