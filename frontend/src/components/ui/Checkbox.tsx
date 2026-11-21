import React from 'react';
import { cn } from '../../utils/cn';

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  testId?: string;
  wrapperClassName?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  description,
  testId,
  wrapperClassName,
  className,
  disabled,
  ...rest
}) => (
  <label
    className={cn(
      'flex min-h-[44px] cursor-pointer items-start gap-3 py-2',
      disabled && 'cursor-not-allowed opacity-60',
      wrapperClassName
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      data-testid={testId}
      onChange={(e) => onChange(e.target.checked)}
      className={cn('ks-check mt-0.5 min-h-[20px]', className)}
      {...rest}
    />
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-theme-text">{label}</span>
      {description && <span className="block text-sm text-theme-text-muted">{description}</span>}
    </span>
  </label>
);
