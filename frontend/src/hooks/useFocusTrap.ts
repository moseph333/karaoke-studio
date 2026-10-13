import { useEffect, useRef } from 'react';

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return elements.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.tabIndex === -1) return false;
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || el.hidden) return false;
    return true;
  });
}

export interface UseFocusTrapOptions {
  isOpen: boolean;
  onClose?: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  triggerRef?: React.RefObject<HTMLElement | null>;
  escapeDeactivates?: boolean;
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  initialFocusRef,
  triggerRef,
  escapeDeactivates = true,
}: UseFocusTrapOptions): React.RefObject<T> {
  const containerRef = useRef<T | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // 1. Initial focus placement and return focus on close
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      triggerRef?.current ?? (document.activeElement as HTMLElement | null);

    const focusInitial = () => {
      const container = containerRef.current;
      if (!container) return;

      if (document.activeElement && container.contains(document.activeElement)) {
        return;
      }

      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }

      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    };

    focusInitial();
    const rafId = requestAnimationFrame(focusInitial);

    return () => {
      cancelAnimationFrame(rafId);
      const prevEl = previousActiveElementRef.current;
      if (prevEl && typeof prevEl.focus === 'function' && prevEl.isConnected) {
        prevEl.focus();
      }
    };
  }, [isOpen, initialFocusRef, triggerRef]);

  // 2. Keyboard event handling: Escape dismissal & Tab cycling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escapeDeactivates) {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }

      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;

        const focusable = getFocusableElements(container);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !container.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, escapeDeactivates]);

  return containerRef;
}
