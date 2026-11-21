import React, { useRef } from 'react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

export interface TabItem<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  /** id(s) of the controlled tabpanel(s). */
  controls?: string;
  ariaLabel?: string;
  testId?: string;
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  /** Maps a tab id to the DOM id of its tab element. */
  getTabId?: (id: T) => string;
  fullWidth?: boolean;
  className?: string;
  tabClassName?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  getTabId,
  fullWidth = false,
  className,
  tabClassName,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next].id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        // The baseline is an inset shadow so the active underline can cover it without
        // overflowing (a scrollable tablist would otherwise grow a 1px vertical scrollbar).
        'flex gap-x-6 shadow-[inset_0_-1px_0_rgb(var(--theme-border-subtle-rgb))]',
        fullWidth && 'w-full',
        className
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={getTabId ? getTabId(item.id) : undefined}
            aria-selected={active}
            aria-controls={item.controls}
            aria-label={item.ariaLabel}
            tabIndex={active ? 0 : -1}
            data-testid={item.testId}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // Text tabs: the open one is underlined in yellow
              'ks-display relative inline-flex min-h-[44px] items-center justify-center gap-1.5 border-b-[3px] text-[22px] transition-colors duration-150 select-none md:min-h-[38px]',
              fullWidth && 'flex-1',
              active
                ? 'border-theme-accent text-theme-text'
                : 'border-transparent text-theme-text-muted hover:text-theme-text',
              focusRing,
              tabClassName
            )}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
