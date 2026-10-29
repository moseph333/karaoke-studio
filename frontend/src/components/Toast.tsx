/**
 * Toast Notification Component
 *
 * Renders non-intrusive notification toasts (success, error, warning, info)
 * with auto-dismiss timers, pause-on-hover, an optional action button, and dismiss buttons.
 */

import React, { useEffect, useState } from 'react';
import { Toast, ToastType } from '../types';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { Button } from './ui/Button';
import { focusRing } from './ui/variants';

const TOAST_VARIANTS: Record<
  ToastType,
  {
    Icon: typeof Info;
    border: string;
    icon: string;
    role: 'status' | 'alert';
    live: 'polite' | 'assertive';
  }
> = {
  success: {
    Icon: CheckCircle2,
    border: 'border-theme-success/45',
    icon: 'text-theme-success',
    role: 'status',
    live: 'polite',
  },
  error: {
    Icon: AlertCircle,
    border: 'border-theme-danger/55',
    icon: 'text-theme-danger',
    role: 'alert',
    live: 'assertive',
  },
  warning: {
    Icon: AlertTriangle,
    border: 'border-theme-warning/45',
    icon: 'text-theme-warning',
    role: 'status',
    live: 'polite',
  },
  info: {
    Icon: Info,
    border: 'border-theme-info/45',
    icon: 'text-theme-info',
    role: 'status',
    live: 'polite',
  },
};

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

export const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 4000;
    if (duration <= 0 || isPaused) return;

    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, isPaused, onDismiss]);

  const style = TOAST_VARIANTS[toast.type] ?? TOAST_VARIANTS.info;
  const Icon = style.Icon;
  const action = toast.action;

  return (
    <div
      role={style.role}
      aria-live={style.live}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-theme-lg border bg-theme-surface-raised/95 p-3.5 text-theme-text shadow-theme-lg backdrop-blur-md motion-safe:animate-fade-in',
        style.border
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', style.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words pt-0.5 text-sm leading-snug">{toast.message}</div>
      {action && (
        <Button
          size="sm"
          variant="primary"
          className="-my-1 shrink-0"
          onClick={() => {
            action.onClick();
            onDismiss(toast.id);
          }}
        >
          {action.label}
        </Button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className={cn(
          '-m-1 inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-theme-md text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text',
          focusRing
        )}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-height,0px)+1rem)] z-[60] flex flex-col items-center gap-2.5 px-4 sm:inset-x-auto sm:right-5 sm:w-full sm:max-w-sm sm:items-end sm:px-0"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
