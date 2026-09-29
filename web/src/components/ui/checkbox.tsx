'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: ReactNode;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, id, ...rest },
  ref
) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 text-sm text-foreground',
        className
      )}
    >
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
        {...rest}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
});
