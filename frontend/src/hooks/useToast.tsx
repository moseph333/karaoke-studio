import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Toast, ToastType } from '../types';
import { ToastContainer } from '../components/Toast';

export interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  toast: {
    show: (message: string, type?: ToastType, duration?: number) => string;
    success: (message: string, duration?: number) => string;
    error: (message: string, duration?: number) => string;
    info: (message: string, duration?: number) => string;
    warning: (message: string, duration?: number) => string;
    dismiss: (id: string) => void;
    clear: () => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 4000) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newToast: Toast = {
        id,
        message,
        type,
        duration,
        createdAt: Date.now(),
      };
      setToasts((prev) => [...prev, newToast]);
      return id;
    },
    []
  );

  const success = useCallback(
    (message: string, duration?: number) => showToast(message, 'success', duration),
    [showToast]
  );
  const error = useCallback(
    (message: string, duration?: number) => showToast(message, 'error', duration),
    [showToast]
  );
  const info = useCallback(
    (message: string, duration?: number) => showToast(message, 'info', duration),
    [showToast]
  );
  const warning = useCallback(
    (message: string, duration?: number) => showToast(message, 'warning', duration),
    [showToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      showToast,
      dismissToast,
      clearToasts,
      success,
      error,
      info,
      warning,
      toast: {
        show: showToast,
        success,
        error,
        info,
        warning,
        dismiss: dismissToast,
        clear: clearToasts,
      },
    }),
    [toasts, showToast, dismissToast, clearToasts, success, error, info, warning]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

/**
 * Custom hook to trigger toast notifications.
 * Includes a resilient fallback so isolated unit tests without ToastProvider never throw errors.
 */
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    const noopId = () => '';
    const noop = () => {};
    return {
      toasts: [],
      showToast: noopId,
      dismissToast: noop,
      clearToasts: noop,
      success: noopId,
      error: noopId,
      info: noopId,
      warning: noopId,
      toast: {
        show: noopId,
        success: noopId,
        error: noopId,
        info: noopId,
        warning: noopId,
        dismiss: noop,
        clear: noop,
      },
    };
  }
  return context;
};
