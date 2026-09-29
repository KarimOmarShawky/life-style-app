'use client';

import {
  useFormContext,
  type FieldValues,
  type Path,
  type UseFormRegisterReturn
} from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FormFieldProps<T extends FieldValues> {
  name: Path<T>;
  label: string;
  hint?: string;
  required?: boolean;
  children: (
    props: UseFormRegisterReturn & {
      id: string;
      'aria-invalid'?: boolean;
      'aria-describedby'?: string;
    }
  ) => React.ReactNode;
  className?: string;
}

/**
 * Binds a react-hook-form field to an accessible label + error/hint text
 * using `aria-invalid` / `aria-describedby`.
 */
export function FormField<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  children,
  className
}: FormFieldProps<T>) {
  const {
    register,
    formState: { errors }
  } = useFormContext<T>();
  const error = errors[name];
  const errorId = `${String(name)}-error`;
  const hintId = `${String(name)}-hint`;
  const message =
    error && typeof error.message === 'string' && error.message.length > 0 ? error.message : null;
  const describedBy = [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={name}>
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children({
        id: name,
        ...register(name),
        'aria-invalid': message ? true : undefined,
        'aria-describedby': describedBy || undefined
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
