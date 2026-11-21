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
  <div className={cn('flex flex-col items-start gap-2 py-8', className)}>
    {icon && (
      <span aria-hidden="true" className="text-theme-text-muted">
        {icon}
      </span>
    )}
    <p className="ks-display text-[26px] text-theme-text">{title}</p>
    {description && <p className="max-w-prose text-base text-theme-text-muted">{description}</p>}
    {action}
  </div>
);
