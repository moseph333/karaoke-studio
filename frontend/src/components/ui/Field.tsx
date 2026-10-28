import React from 'react';
import { cn } from '../../utils/cn';

export const inputBase =
  'w-full min-h-[44px] rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle px-3 text-base sm:text-sm text-theme-text placeholder:text-theme-text-muted/70 transition-colors focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/40 disabled:cursor-not-allowed disabled:opacity-60';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...rest }, ref) => (
  <input ref={ref} className={cn(inputBase, className)} {...rest} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={cn(inputBase, 'py-2.5 leading-relaxed', className)} {...rest} />
));
Textarea.displayName = 'Textarea';

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}) => (
  <div className={cn('space-y-1.5', className)}>
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-theme-text-muted">
      {label}
    </label>
    {children}
    {error ? (
      <p className="text-xs text-theme-danger">{error}</p>
    ) : hint ? (
      <p className="text-xs text-theme-text-muted">{hint}</p>
    ) : null}
  </div>
);
