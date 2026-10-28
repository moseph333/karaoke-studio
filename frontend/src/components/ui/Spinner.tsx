import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SpinnerProps {
  className?: string;
  /** Accessible label; when omitted the spinner is decorative (aria-hidden). */
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ className, label }) => (
  <Loader2
    className={cn('w-4 h-4 animate-spin shrink-0', className)}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
  />
);
