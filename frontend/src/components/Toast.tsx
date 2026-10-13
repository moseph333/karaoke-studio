import React, { useEffect, useState } from 'react';
import { Toast, ToastType } from '../types';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

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

  const getVariantStyles = (type: ToastType) => {
    switch (type) {
      case 'success':
        return {
          container: 'bg-slate-900/95 border-emerald-500/50 text-emerald-200 shadow-emerald-950/40',
          icon: (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          ),
          ariaRole: 'status' as const,
          ariaLive: 'polite' as const,
        };
      case 'error':
        return {
          container: 'bg-slate-900/95 border-rose-500/60 text-rose-200 shadow-rose-950/40',
          icon: (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          ),
          ariaRole: 'alert' as const,
          ariaLive: 'assertive' as const,
        };
      case 'warning':
        return {
          container: 'bg-slate-900/95 border-amber-500/50 text-amber-200 shadow-amber-950/40',
          icon: (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          ),
          ariaRole: 'status' as const,
          ariaLive: 'polite' as const,
        };
      case 'info':
      default:
        return {
          container: 'bg-slate-900/95 border-cyan-500/50 text-cyan-200 shadow-cyan-950/40',
          icon: <Info className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />,
          ariaRole: 'status' as const,
          ariaLive: 'polite' as const,
        };
    }
  };

  const style = getVariantStyles(toast.type);

  return (
    <div
      role={style.ariaRole}
      aria-live={style.ariaLive}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-xl backdrop-blur-md transition-all duration-300 w-full max-w-sm ${style.container}`}
    >
      {style.icon}
      <div className="flex-1 text-xs font-medium leading-relaxed break-words">{toast.message}</div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-cyan-400"
      >
        <X className="w-4 h-4" aria-hidden="true" />
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
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
