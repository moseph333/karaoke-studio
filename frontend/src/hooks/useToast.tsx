/**
 * Toast Notification Context & Hook
 *
 * Provides application-wide toast dispatching methods (success, error, info, warning)
 * and renders the fixed ToastContainer overlay for reactive alerts.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Toast, ToastAction, ToastType } from '../types';
import { ToastContainer } from '../components/Toast';

// Errors stay twice as long as other toasts: they usually need reading, not a glance
const ERROR_TOAST_DURATION_MS = 8000;

export interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number, action?: ToastAction) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  toast: {
    show: (message: string, type?: ToastType, duration?: number, action?: ToastAction) => string;
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
    (message: string, type: ToastType = 'info', duration: number = 4000, action?: ToastAction) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const newToast: Toast = {
        id,
        message,
        type,
        duration,
        createdAt: Date.now(),
        ...(action ? { action } : {}),
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
    (message: string, duration?: number) =>
      showToast(message, 'error', duration ?? ERROR_TOAST_DURATION_MS),
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

  // The same `toast` object for the provider's lifetime, so hooks may list it as a
  // dependency without re-running whenever a toast appears or leaves
  const toast = useMemo(
    () => ({
      show: showToast,
      success,
      error,
      info,
      warning,
      dismiss: dismissToast,
      clear: clearToasts,
    }),
    [showToast, success, error, info, warning, dismissToast, clearToasts]
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
      toast,
    }),
    [toasts, showToast, dismissToast, clearToasts, success, error, info, warning, toast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

const noopId = () => '';
const noop = () => {};

// Without a ToastProvider (isolated unit tests) toasts are dropped; one constant keeps the
// handlers stable for hooks that depend on them
const NO_PROVIDER: ToastContextValue = {
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

/**
 * Custom hook to trigger toast notifications.
 * Includes a resilient fallback so isolated unit tests without ToastProvider never throw errors.
 */
export const useToast = (): ToastContextValue => useContext(ToastContext) ?? NO_PROVIDER;
