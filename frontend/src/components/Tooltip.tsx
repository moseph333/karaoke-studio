/**
 * Styled Accessible Contextual Tooltip Component
 *
 * Provides accessible hover and focus tooltips with optional keyboard shortcut badge hints
 * (<kbd>). Manages ARIA described-by linking and Escape key dismissal. The bubble can be
 * hovered (WCAG 1.4.13): leaving the trigger closes it after a moment, so the pointer can
 * move onto it, while on touch screens it never takes taps. `portal` renders the bubble in
 * document.body with fixed positioning so scroll containers and overflow-hidden cards
 * cannot clip it.
 */

import React, { useState, useRef, useEffect, useId, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { isQuietFocus } from '../utils/focusIntent';

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
  /** Render the bubble in document.body (fixed) so clipping ancestors cannot hide it. */
  portal?: boolean;
}

const GAP = 8;
const VIEWPORT_MARGIN = 8;
// Time to move the pointer from the trigger onto the bubble before it closes
export const TOOLTIP_HIDE_DELAY_MS = 120;

const POSITION_CLASSES: Record<
  NonNullable<TooltipProps['position']>,
  Record<NonNullable<TooltipProps['align']>, string>
> = {
  top: {
    start: 'bottom-full mb-2 left-0',
    center: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    end: 'bottom-full mb-2 right-0',
  },
  bottom: {
    start: 'top-full mt-2 left-0',
    center: 'top-full mt-2 left-1/2 -translate-x-1/2',
    end: 'top-full mt-2 right-0',
  },
  left: {
    start: 'right-full mr-2 top-1/2 -translate-y-1/2',
    center: 'right-full mr-2 top-1/2 -translate-y-1/2',
    end: 'right-full mr-2 top-1/2 -translate-y-1/2',
  },
  right: {
    start: 'left-full ml-2 top-1/2 -translate-y-1/2',
    center: 'left-full ml-2 top-1/2 -translate-y-1/2',
    end: 'left-full ml-2 top-1/2 -translate-y-1/2',
  },
};

/** Fixed coordinates for a portaled bubble, flipped and clamped to stay on screen. */
function placeBubble(
  trigger: DOMRect,
  bubble: { width: number; height: number },
  position: NonNullable<TooltipProps['position']>,
  align: NonNullable<TooltipProps['align']>
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let side = position;
  if (side === 'top' && trigger.top - GAP - bubble.height < VIEWPORT_MARGIN) side = 'bottom';
  else if (side === 'bottom' && trigger.bottom + GAP + bubble.height > vh - VIEWPORT_MARGIN)
    side = 'top';
  else if (side === 'left' && trigger.left - GAP - bubble.width < VIEWPORT_MARGIN) side = 'right';
  else if (side === 'right' && trigger.right + GAP + bubble.width > vw - VIEWPORT_MARGIN)
    side = 'left';

  let left: number;
  let top: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? trigger.top - GAP - bubble.height : trigger.bottom + GAP;
    left =
      align === 'start'
        ? trigger.left
        : align === 'end'
          ? trigger.right - bubble.width
          : trigger.left + trigger.width / 2 - bubble.width / 2;
  } else {
    left = side === 'left' ? trigger.left - GAP - bubble.width : trigger.right + GAP;
    top = trigger.top + trigger.height / 2 - bubble.height / 2;
  }
  const clamp = (v: number, size: number, max: number) =>
    Math.min(Math.max(v, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, max - size - VIEWPORT_MARGIN));
  return { left: clamp(left, bubble.width, vw), top: clamp(top, bubble.height, vh) };
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
  portal = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
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

  // The pointer left the trigger or the bubble: close unless it arrives on the other
  const hideSoon = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setIsOpen(false);
    }, TOOLTIP_HIDE_DELAY_MS);
  }, []);

  const keepOpen = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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

  // Portaled bubbles are measured and placed before paint, and close when the page moves
  // underneath them rather than drifting away from their trigger.
  useLayoutEffect(() => {
    if (!portal || !isOpen) {
      setCoords(null);
      return;
    }
    const trigger = wrapperRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (trigger && bubble) {
      setCoords(placeBubble(trigger, bubble, position, align));
    }
  }, [portal, isOpen, position, align, content]);

  useEffect(() => {
    if (!portal || !isOpen) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [portal, isOpen, hide]);

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
      hideSoon();
      children.props.onMouseLeave?.(e);
    },
    onFocus: (e: React.FocusEvent) => {
      // Skip focus placed by code (e.g. a dialog's initial focus) so tooltips appear only
      // for keyboard navigation and hover.
      if (!isQuietFocus(e.target)) show(true);
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

  const bubble = isOpen ? (
    <span
      ref={bubbleRef}
      id={tooltipId}
      role="tooltip"
      aria-hidden={!isOpen}
      style={portal ? { left: coords?.left ?? 0, top: coords?.top ?? 0 } : undefined}
      onMouseEnter={keepOpen}
      onMouseLeave={hideSoon}
      className={clsx(
        // Hoverable where a pointer hovers; never in the way of taps on touch screens
        'pointer-events-none [@media(hover:hover)]:pointer-events-auto z-[70] rounded-theme-md border border-theme-border bg-theme-surface-raised/95 px-2.5 py-1.5 font-theme-body text-xs font-medium text-theme-text shadow-theme-lg backdrop-blur-md',
        'max-w-[200px] sm:max-w-[260px] whitespace-normal break-words text-center',
        'flex items-center justify-center gap-1.5',
        portal ? 'fixed w-max' : 'absolute',
        portal ? !coords && 'invisible' : POSITION_CLASSES[position][align]
      )}
    >
      <span>{content}</span>
      {hotkeys.length > 0 && (
        <span className="ml-1 inline-flex shrink-0 items-center gap-1">
          {hotkeys.map((k, idx) => (
            <kbd
              key={idx}
              className="inline-flex min-w-[16px] items-center justify-center rounded-theme-sm border border-theme-border-subtle bg-theme-surface-subtle px-1.5 py-0.5 font-mono text-[10px] font-bold text-theme-highlight shadow-theme-sm"
            >
              {k}
            </kbd>
          ))}
        </span>
      )}
    </span>
  ) : null;

  return (
    <span
      ref={wrapperRef}
      className={clsx(
        !hasPositionClass && 'relative',
        'inline-flex flex-wrap items-center',
        className
      )}
    >
      {trigger}
      {bubble && (portal ? createPortal(bubble, document.body) : bubble)}
    </span>
  );
};

export default Tooltip;
