'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Auth pages layout: calm branded split screen. Client-only because auth
 * state is memory-only and must never render on the server.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between border-r border-border bg-surface p-10 lg:flex">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-primary text-base font-bold text-on-primary"
          >
            L
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">LifeStyle</span>
        </Link>
        <div className="max-w-md space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Plan → Focus → Do → Track → Review
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your personal life operating system: tasks, habits, goals, calendar, notes, and money —
            in one calm, focused workspace.
          </p>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>• Evergreen-focused planning and daily review</li>
            <li>• Focus timer with task-linked sessions</li>
            <li>• Money tracking with exact decimal math</li>
          </ul>
        </div>
        <p className="text-xs text-subtle-foreground">
          Sessions are held in memory only — signing out (or reloading) clears them.
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
