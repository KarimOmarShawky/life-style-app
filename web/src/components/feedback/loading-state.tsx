import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export function LoadingState({
  label = 'Loading…',
  className
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground',
        className
      )}
    >
      <Spinner className="size-6 text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-1', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="size-4 shrink-0 animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 flex-1 animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 w-16 animate-pulse rounded bg-surface-sunken" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
