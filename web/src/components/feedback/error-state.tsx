'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  /** Compact inline variant for cards. */
  compact?: boolean;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.userMessage;
  return 'Something went wrong. Please try again.';
}

function requestIdOf(error: unknown): string | null {
  if (error instanceof ApiError && error.requestId) return error.requestId;
  return null;
}

/**
 * Retryable error state with a safe user-facing message. Never renders stack
 * traces, raw server responses, or internal details.
 */
export function ErrorState({ error, onRetry, compact = false }: ErrorStateProps) {
  const requestId = requestIdOf(error);
  return (
    <div
      role="alert"
      className={compact ? 'space-y-2' : 'flex flex-col items-center gap-3 py-8 text-center'}
    >
      <Alert variant="error" title="Couldn’t load this content">
        {messageOf(error)}
      </Alert>
      {requestId ? <p className="text-xs text-subtle-foreground">Reference: {requestId}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
      {!compact ? (
        <span className="sr-only">
          <AlertCircle aria-hidden="true" /> Error
        </span>
      ) : null}
    </div>
  );
}
