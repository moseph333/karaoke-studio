import React from 'react';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center gap-3 rounded-theme-xl border border-dashed border-theme-border-subtle bg-theme-surface-subtle/40 px-6 py-10 text-center',
      className
    )}
  >
    {icon && (
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-theme-lg bg-theme-accent/15 text-theme-highlight"
      >
        {icon}
      </span>
    )}
    <p className="text-sm font-semibold text-theme-text">{title}</p>
    {description && <p className="max-w-sm text-sm text-theme-text-muted">{description}</p>}
    {action}
  </div>
);
