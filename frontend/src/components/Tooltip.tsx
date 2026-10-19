/**
 * Styled Accessible Contextual Tooltip Component
 *
 * Provides accessible, glassmorphic hover and focus tooltips with optional
 * keyboard shortcut badge hints (<kbd>). Manages ARIA described-by linking,
 * Escape key dismissal, and touch-safe pointer-events suppression.
 */

import React, { useState, useRef, useEffect, useId, useCallback } from 'react';
import clsx from 'clsx';

export interface TooltipProps {
  /** Descriptive tooltip text or element */
  content: React.ReactNode;
  /** Optional keyboard shortcut key or keys (e.g. "Space", "M", "?", ["←", "→"]) */
  hotkey?: string | string[];
  /** Preferred tooltip placement */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** Alignment relative to the trigger */
  align?: 'start' | 'center' | 'end';
  /** Delay in milliseconds before opening on hover (default: 150ms) */
  delayMs?: number;
  /** Single child element that triggers the tooltip */
  children: React.ReactElement;
  /** Disable tooltip display */
  disabled?: boolean;
  /** Optional container class overrides (e.g. 'flex-1', 'w-full') */
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  hotkey,
  position = 'top',
  align = 'center',
  delayMs = 150,
  children,
  disabled = false,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedId = useId();
  const tooltipId = `tooltip-${generatedId.replace(/:/g, '')}`;

  const show = useCallback(
    (immediate = false) => {
      if (disabled) return;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (immediate || delayMs <= 0) {
        setIsOpen(true);
      } else {
        timerRef.current = setTimeout(() => setIsOpen(true), delayMs);
      }
    },
    [disabled, delayMs]
  );

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsOpen(false);
  }, []);

  // Synchronize when disabled prop transitions to true
  useEffect(() => {
    if (disabled) {
      hide();
    }
  }, [disabled, hide]);

  // Escape key listener while tooltip is open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, hide]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Calculate position classes
  const getPositionClasses = () => {
    switch (position) {
      case 'bottom':
        return align === 'start'
          ? 'top-full mt-2 left-0'
          : align === 'end'
            ? 'top-full mt-2 right-0'
            : 'top-full mt-2 left-1/2 -translate-x-1/2';
      case 'left':
        return 'right-full mr-2 top-1/2 -translate-y-1/2';
      case 'right':
        return 'left-full ml-2 top-1/2 -translate-y-1/2';
      case 'top':
      default:
        return align === 'start'
          ? 'bottom-full mb-2 left-0'
          : align === 'end'
            ? 'bottom-full mb-2 right-0'
            : 'bottom-full mb-2 left-1/2 -translate-x-1/2';
    }
  };

  const hotkeys = Array.isArray(hotkey) ? hotkey : hotkey ? [hotkey] : [];

  // Clone trigger child to attach event handlers and aria-describedby
  const trigger = React.cloneElement(children, {
    'aria-describedby': isOpen
      ? [children.props['aria-describedby'], tooltipId].filter(Boolean).join(' ')
      : children.props['aria-describedby'],
    title: undefined, // Suppress default browser native tooltip collision
    onMouseEnter: (e: React.MouseEvent) => {
      show(false);
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      show(true);
      children.props.onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      hide();
      children.props.onBlur?.(e);
    },
    onClick: (e: React.MouseEvent) => {
      hide();
      children.props.onClick?.(e);
    },
  });

  const hasPositionClass =
    className !== undefined && /\b(absolute|fixed|sticky|static)\b/.test(className);

  return (
    <span
      className={clsx(
        !hasPositionClass && 'relative',
        'inline-flex flex-wrap items-center',
        className
      )}
    >
      {trigger}
      {isOpen && (
        <span
          id={tooltipId}
          role="tooltip"
          aria-hidden={!isOpen}
          className={clsx(
            'absolute z-50 pointer-events-none px-2.5 py-1.5 rounded-lg text-xs font-medium',
            'bg-slate-950/95 text-slate-100 border border-slate-700/80 shadow-2xl backdrop-blur-md',
            'max-w-[200px] sm:max-w-[260px] whitespace-normal break-words text-center transition-opacity duration-150',
            'flex items-center justify-center gap-1.5',
            getPositionClasses()
          )}
        >
          <span>{content}</span>
          {hotkeys.length > 0 && (
            <span className="inline-flex items-center gap-1 ml-1 shrink-0">
              {hotkeys.map((k, idx) => (
                <kbd
                  key={idx}
                  className="inline-flex items-center justify-center min-w-[16px] px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm"
                >
                  {k}
                </kbd>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

export default Tooltip;
