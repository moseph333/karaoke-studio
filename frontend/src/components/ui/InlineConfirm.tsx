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
      className={cn('max-w-sm space-y-3 border-2 border-theme-border p-4', className)}
    >
      <p id={titleId} className="text-sm font-semibold text-theme-text">
        {message}
      </p>
      {/* Wraps on narrow phones, where both choices side by side would overflow */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            'ks-display min-h-[44px] border border-theme-danger bg-theme-danger px-3.5 text-[20px] text-theme-text-inverse transition-[filter] hover:brightness-110 md:min-h-[36px]',
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
            'ks-display min-h-[44px] border border-theme-border px-3.5 text-[20px] text-theme-text transition-colors hover:bg-theme-text hover:text-theme-text-inverse md:min-h-[36px]',
            focusRing
          )}
        >
          {keepLabel}
        </button>
      </div>
    </div>
  );
};
