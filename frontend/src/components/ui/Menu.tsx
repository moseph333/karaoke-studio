import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
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
  /** Renders a radio item (role="menuitemradio") with this checked state. */
  checked?: boolean;
  /** Caption shown above the first item of each group. */
  group?: string;
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
  /** Optional visible caption above the items. */
  title?: string;
  align?: 'start' | 'end';
  /** `auto` opens toward whichever side has more room. */
  side?: 'bottom' | 'top' | 'auto';
  /**
   * Render into document.body with fixed positioning so scrolling containers cannot clip
   * the menu. The menu closes when the page scrolls or resizes.
   */
  portal?: boolean;
  className?: string;
  menuClassName?: string;
}

const ITEM_HEIGHT_ESTIMATE = 44;

/** Top and bottom edges of the nearest ancestor that clips overflow (or the viewport). */
function clippingEdges(el: HTMLElement): { top: number; bottom: number } {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node);
    if (/(auto|scroll|hidden|clip)/.test(overflowY)) {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

/**
 * Accessible dropdown menu (role="menu"). Rendered only while open; navigation keys stop
 * propagation so global media shortcuts never fire from inside the menu.
 */
export const Menu: React.FC<MenuProps> = ({
  label,
  trigger,
  items,
  title,
  align = 'end',
  side = 'bottom',
  portal = false,
  className,
  menuClassName,
}) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolvedSide, setResolvedSide] = useState<'bottom' | 'top'>(
    side === 'top' ? 'top' : 'bottom'
  );
  const [fixedStyle, setFixedStyle] = useState<React.CSSProperties | undefined>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = `menu-${useId().replace(/:/g, '')}`;

  const enabledIndices = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Pick the side and (for portals) the fixed coordinates before the menu paints.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    let nextSide: 'bottom' | 'top' = side === 'top' ? 'top' : 'bottom';
    if (side === 'auto') {
      const edges = portal
        ? { top: 0, bottom: window.innerHeight }
        : clippingEdges(triggerRef.current);
      const captions =
        (title ? 1 : 0) +
        items.filter((it, i) => it.group && it.group !== items[i - 1]?.group).length;
      const needed = items.length * ITEM_HEIGHT_ESTIMATE + captions * 32 + 16;
      const below = edges.bottom - rect.bottom;
      const above = rect.top - edges.top;
      nextSide = below < needed && above > below ? 'top' : 'bottom';
    }
    setResolvedSide(nextSide);
    if (portal) {
      setFixedStyle({
        position: 'fixed',
        ...(nextSide === 'bottom'
          ? { top: rect.bottom + 6 }
          : { bottom: window.innerHeight - rect.top + 6 }),
        ...(align === 'end'
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: Math.max(8, rect.left) }),
      });
    }
    // Measure once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = enabledIndices[0] ?? 0;
    setActiveIndex(first);
    requestAnimationFrame(() => itemRefs.current[first]?.focus());
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (wrapperRef.current?.contains(target) || menuRef.current?.contains(target));
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!isInside(e.target)) setOpen(false);
    };
    const onViewportChange = (e: Event) => {
      if (e.type === 'scroll' && isInside(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    if (portal) {
      window.addEventListener('scroll', onViewportChange, true);
      window.addEventListener('resize', onViewportChange);
    }
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
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
      // A portaled menu sits at the end of the document; hand focus back to the trigger
      // so Tab continues from there.
      close(portal);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      style={portal ? fixedStyle : undefined}
      className={cn(
        'z-50 min-w-[200px] overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-surface-raised p-1 shadow-theme-lg motion-safe:animate-slide-down',
        !portal && 'absolute',
        !portal && (align === 'end' ? 'right-0' : 'left-0'),
        !portal && (resolvedSide === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'),
        portal && !fixedStyle && 'invisible',
        menuClassName
      )}
    >
      {title && (
        <div
          role="presentation"
          className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-theme-text-muted"
        >
          {title}
        </div>
      )}
      {items.map((item, index) => {
        const isRadio = typeof item.checked === 'boolean';
        const startsGroup = Boolean(item.group) && item.group !== items[index - 1]?.group;
        return (
          <React.Fragment key={item.id}>
            {startsGroup && (
              <div
                role="presentation"
                className={cn(
                  'px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-theme-text-muted',
                  index > 0 && 'mt-1 border-t border-theme-border-subtle pt-2'
                )}
              >
                {item.group}
              </div>
            )}
            <button
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role={isRadio ? 'menuitemradio' : 'menuitem'}
              aria-checked={isRadio ? item.checked : undefined}
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
              {isRadio && (
                <Check
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 shrink-0 text-theme-highlight',
                    item.checked ? 'opacity-100' : 'opacity-0'
                  )}
                />
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className={cn('relative inline-flex', className)}>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
      })}
      {menu && (portal ? createPortal(menu, document.body) : menu)}
    </div>
  );
};
