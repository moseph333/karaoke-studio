/**
 * Inline Confirm
 *
 * A button that turns into a small confirmation in its place ("Cancel the render? ...
 * [Confirm] [Keep]"), for destructive actions that do not deserve a dialog. Focus moves to
 * the safe choice when it opens, and back to the trigger when the user keeps going.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

export interface InlineConfirmProps {
  /** The trigger, in the caller's style: give it `ref` and `onClick`. */
  renderTrigger: (trigger: {
    ref: React.RefObject<HTMLButtonElement>;
    onClick: () => void;
  }) => React.ReactNode;
  message: React.ReactNode;
  confirmLabel: string;
  keepLabel: string;
  onConfirm: () => void;
  className?: string;
}

export const InlineConfirm: React.FC<InlineConfirmProps> = ({
  renderTrigger,
  message,
  confirmLabel,
  keepLabel,
  onConfirm,
  className,
}) => {
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const wasAskingRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (asking) {
      wasAskingRef.current = true;
      keepRef.current?.focus();
    } else if (wasAskingRef.current) {
      wasAskingRef.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  if (!asking) {
    return <>{renderTrigger({ ref: triggerRef, onClick: () => setAsking(true) })}</>;
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      className={cn(
        'mx-auto max-w-sm space-y-3 rounded-theme-lg border border-theme-border bg-theme-surface-raised p-4 shadow-theme-md',
        className
      )}
    >
      <p id={titleId} className="text-sm font-semibold text-theme-text">
        {message}
      </p>
      {/* Wraps on narrow phones, where both choices side by side would overflow */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            'min-h-[36px] rounded-theme-md bg-theme-danger px-3.5 py-1.5 font-theme-heading text-xs font-bold text-white transition-[filter] hover:brightness-110',
            focusRing
          )}
        >
          {confirmLabel}
        </button>
        <button
          ref={keepRef}
          type="button"
          onClick={() => setAsking(false)}
          className={cn(
            'min-h-[36px] rounded-theme-md border border-theme-border-subtle bg-theme-surface px-3.5 py-1.5 text-xs font-medium text-theme-text transition-colors hover:border-theme-border',
            focusRing
          )}
        >
          {keepLabel}
        </button>
      </div>
    </div>
  );
};
