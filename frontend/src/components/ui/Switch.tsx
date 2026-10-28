import React, { useId } from 'react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  testId,
  className,
}) => {
  const labelId = `switch-label-${useId().replace(/:/g, '')}`;
  return (
    <div className={cn('flex min-h-[44px] items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <span id={labelId} className="block text-sm font-medium text-theme-text">
          {label}
        </span>
        {description && <span className="block text-xs text-theme-text-muted">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 min-w-[44px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
          checked
            ? 'border-transparent bg-theme-accent'
            : 'border-theme-border bg-theme-surface-raised',
          focusRing
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-6' : 'translate-x-1'
          )}
        />
      </button>
    </div>
  );
};
