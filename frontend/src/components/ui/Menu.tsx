import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

export interface MenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  testId?: string;
}

export interface MenuTriggerProps {
  ref: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls'?: string;
}

export interface MenuProps {
  /** Accessible name for the menu. */
  label: string;
  trigger: (props: MenuTriggerProps) => React.ReactElement;
  items: ReadonlyArray<MenuItem>;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
  menuClassName?: string;
}

/**
 * Accessible dropdown menu (role="menu"). Rendered only while open; navigation keys stop
 * propagation so global media shortcuts never fire from inside the menu.
 */
export const Menu: React.FC<MenuProps> = ({
  label,
  trigger,
  items,
  align = 'end',
  side = 'bottom',
  className,
  menuClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = `menu-${useId().replace(/:/g, '')}`;

  const enabledIndices = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const first = enabledIndices[0] ?? 0;
    setActiveIndex(first);
    requestAnimationFrame(() => itemRefs.current[first]?.focus());
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
    // enabledIndices is derived from items; re-run only when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const focusItem = (index: number) => {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const pos = enabledIndices.indexOf(activeIndex);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      focusItem(enabledIndices[(pos + 1) % enabledIndices.length]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      focusItem(enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      focusItem(enabledIndices[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      focusItem(enabledIndices[enabledIndices.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  return (
    <div ref={wrapperRef} className={cn('relative inline-flex', className)}>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
      })}
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute z-50 min-w-[200px] overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-surface-raised p-1 shadow-theme-lg motion-safe:animate-slide-down',
            align === 'end' ? 'right-0' : 'left-0',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            menuClassName
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={item.disabled}
              data-testid={item.testId}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                'flex w-full min-h-[44px] md:min-h-[36px] items-center gap-2.5 rounded-theme-md px-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                item.tone === 'danger'
                  ? 'text-theme-danger hover:bg-theme-danger/10'
                  : 'text-theme-text hover:bg-theme-surface-subtle',
                focusRing
              )}
            >
              {item.icon && (
                <span
                  aria-hidden="true"
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-theme-text-muted"
                >
                  {item.icon}
                </span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span className="text-[11px] font-mono text-theme-text-muted">{item.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
