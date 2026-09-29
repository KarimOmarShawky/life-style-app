import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

const styles: Record<AlertVariant, { wrap: string; icon: ReactNode }> = {
  info: {
    wrap: 'border-info/25 bg-info-soft text-info',
    icon: <Info className="size-4 shrink-0" aria-hidden="true" />
  },
  success: {
    wrap: 'border-success/25 bg-success-soft text-success',
    icon: <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
  },
  warning: {
    wrap: 'border-warning/25 bg-warning-soft text-warning',
    icon: <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
  },
  error: {
    wrap: 'border-danger/25 bg-danger-soft text-danger',
    icon: <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
  }
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant;
  title?: ReactNode;
}

export function Alert({ className, variant = 'info', title, children, ...rest }: AlertProps) {
  const style = styles[variant];
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        style.wrap,
        className
      )}
      {...rest}
    >
      {style.icon}
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'break-words')}>{children}</div> : null}
      </div>
    </div>
  );
}
