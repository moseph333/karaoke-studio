import React from 'react';
import { cn } from '../../utils/cn';
import { modKeyLabel } from '../../utils/platform';

export interface KbdProps {
  /** One key or a sequence of keys. "Mod" renders as ⌘ on Apple platforms and Ctrl elsewhere. */
  keys: string | string[];
  className?: string;
  size?: 'sm' | 'md';
}

export const Kbd: React.FC<KbdProps> = ({ keys, className, size = 'sm' }) => {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {list.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className={cn(
            'inline-flex items-center justify-center rounded-theme-sm border border-theme-border-subtle bg-theme-surface-subtle font-mono font-semibold text-theme-text-muted shadow-[inset_0_-1px_0_rgb(var(--theme-border-rgb))]',
            size === 'sm'
              ? 'min-w-[18px] px-1 py-px text-[10px]'
              : 'min-w-[22px] px-1.5 py-0.5 text-xs'
          )}
        >
          {k === 'Mod' ? modKeyLabel() : k}
        </kbd>
      ))}
    </span>
  );
};
