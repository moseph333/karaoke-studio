import React from 'react';
import { cn } from '../../utils/cn';

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={cn('rounded-theme-md bg-theme-surface-raised motion-safe:animate-pulse', className)}
  />
);
