import React from 'react';
import { cn } from '../../utils/cn';
import { Spinner } from './Spinner';
import { ButtonSize, ButtonVariant, buttonBase, buttonSizes, buttonVariants } from './variants';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  /** Text shown in place of children while loading. */
  loadingLabel?: React.ReactNode;
  /** Stretch to the container width (always, or only below the `sm` breakpoint). */
  fullWidth?: boolean | 'mobile';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      leftIcon,
      rightIcon,
      loading = false,
      loadingLabel,
      fullWidth = false,
      className,
      children,
      disabled,
      type = 'button',
      ...rest
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        buttonBase,
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth === true && 'w-full',
        fullWidth === 'mobile' && 'w-full sm:w-auto',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      {loading && loadingLabel ? loadingLabel : children}
      {!loading && rightIcon}
    </button>
  )
);
Button.displayName = 'Button';
