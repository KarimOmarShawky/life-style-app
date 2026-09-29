import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, id, ...rest },
  ref
) {
  return <input ref={ref} id={id} className={cn('field-control', className)} {...rest} />;
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, id, rows = 4, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      id={id}
      rows={rows}
      className={cn('field-control resize-y', className)}
      {...rest}
    />
  );
});
