'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CursorPaginationProps {
  hasCursor: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onPrevious: () => void;
  loading?: boolean;
}

/**
 * Cursor-based pagination controls (backend uses opaque cursors).
 */
export function CursorPagination({
  hasCursor,
  canGoBack,
  onNext,
  onPrevious,
  loading = false
}: CursorPaginationProps) {
  if (!hasCursor && !canGoBack) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <Button variant="outline" size="sm" onClick={onPrevious} disabled={!canGoBack || loading}>
        <ChevronLeft className="size-3.5" aria-hidden="true" />
        Previous
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasCursor || loading}>
        Next
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}
