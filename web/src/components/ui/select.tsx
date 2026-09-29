import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native `<select>` styled to match the design system. Native selects are
 * fully keyboard- and screen-reader-accessible.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <select ref={ref} className={cn('field-control appearance-none pr-8', className)} {...rest}>
      {children}
    </select>
  );
});
