import React from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { BadgeTone, badgeTones } from './variants';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Leading icon. Warning and danger badges get one by default, so colour is never alone. */
  icon?: React.ReactNode;
  /** Render a leading status dot (pulses when `pulse` is set). */
  dot?: boolean;
  pulse?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      tone = 'neutral',
      size = 'sm',
      icon,
      dot = false,
      pulse = false,
      className,
      children,
      ...rest
    },
    ref
  ) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 font-semibold whitespace-nowrap',
        size === 'sm' ? 'text-xs' : 'text-sm',
        badgeTones[tone],
        className
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          data-dot=""
          className={cn('h-1.5 w-1.5 bg-current', pulse && 'motion-safe:animate-pulse')}
        />
      )}
      {icon ??
        (!dot && tone === 'warning' ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : !dot && tone === 'danger' ? (
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : null)}
      {children}
    </span>
  )
);
Badge.displayName = 'Badge';
