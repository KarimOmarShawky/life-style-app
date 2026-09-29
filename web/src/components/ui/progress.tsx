import { cn } from '@/lib/utils';

export interface ProgressProps {
  /** 0..100 */
  value: number;
  label: string;
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}

const barVariants = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger'
} as const;

export function Progress({ value, label, variant = 'primary', className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full transition-all', barVariants[variant])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
