'use client';

import type { ReactNode } from 'react';
import { LoadingState, ListSkeleton } from './loading-state';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';

export interface AsyncContentProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty: boolean;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;
  skeletonRows?: number;
  loadingLabel?: string;
  children: ReactNode;
}

/**
 * Standard loading / empty / retryable-error / content wrapper used by every
 * data view so all screens share identical states.
 */
export function AsyncContent({
  isLoading,
  isError,
  error,
  isEmpty,
  onRetry,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptyIcon,
  skeletonRows = 4,
  loadingLabel,
  children
}: AsyncContentProps) {
  if (isLoading) {
    return skeletonRows > 0 ? (
      <ListSkeleton rows={skeletonRows} />
    ) : (
      <LoadingState label={loadingLabel} />
    );
  }
  if (isError) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }
  if (isEmpty) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={emptyIcon}
        action={emptyAction}
      />
    );
  }
  return <>{children}</>;
}
