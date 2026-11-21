import React from 'react';
import { cn } from '../../utils/cn';

export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  tone?: 'accent' | 'success' | 'warning';
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
  fillTestId?: string;
  indeterminate?: boolean;
}

const BAR_TONES = {
  accent: 'bg-theme-accent',
  success: 'bg-theme-success',
  warning: 'bg-theme-warning',
} as const;

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  label,
  tone = 'accent',
  size = 'md',
  className,
  testId,
  fillTestId,
  indeterminate = false,
}) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.round(Math.min(max, Math.max(0, value)))}
      data-testid={testId}
      className={cn(
        'w-full overflow-hidden bg-theme-surface-raised',
        size === 'sm' ? 'h-1.5' : 'h-2.5',
        className
      )}
    >
      <div
        data-testid={fillTestId}
        className={cn(
          'h-full transition-[width] duration-500 ease-out',
          BAR_TONES[tone],
          indeterminate && 'w-1/3 motion-safe:animate-pulse'
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
};

export interface ProgressRingProps {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
  children?: React.ReactNode;
  testId?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  value,
  size = 120,
  stroke = 8,
  label,
  className,
  children,
  testId,
}) => {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      data-testid={testId}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-theme-surface-raised"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-theme-accent"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.2, 0.8, 0.2, 1)' }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
};
