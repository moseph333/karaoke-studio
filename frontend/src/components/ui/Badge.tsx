import React from 'react';
import { cn } from '../../utils/cn';
import { BadgeTone, badgeTones } from './variants';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
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
        'inline-flex items-center gap-1.5 rounded-theme-pill border font-semibold whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        badgeTones[tone],
        className
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'w-1.5 h-1.5 rounded-full bg-current',
            pulse && 'motion-safe:animate-pulse'
          )}
        />
      )}
      {icon}
      {children}
    </span>
  )
);
Badge.displayName = 'Badge';
