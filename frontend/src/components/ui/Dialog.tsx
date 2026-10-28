import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { focusRing } from './variants';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'max-w-3xl',
};

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  titleId: string;
  descriptionId?: string;
  size?: DialogSize;
  /** sheet = bottom sheet on mobile / centered card from sm; center = centered card; palette = top-anchored command surface. */
  variant?: 'sheet' | 'center' | 'palette';
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  triggerRef?: React.RefObject<HTMLElement | null>;
  dataModal?: string;
  /** gate = blocking layer above all modals (auth). */
  layer?: 'modal' | 'gate';
  showDragHandle?: boolean;
  className?: string;
  overlayClassName?: string;
  testId?: string;
  children: React.ReactNode;
}

/**
 * Accessible modal dialog shell.
 *
 * Contract: the full-screen overlay carries role="dialog" + aria-modal and the card is its
 * first element child. Renders nothing while closed so global shortcut guards
 * (`isModalActive`) only see open dialogs.
 */
export const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  titleId,
  descriptionId,
  size = 'lg',
  variant = 'sheet',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  initialFocusRef,
  triggerRef,
  dataModal,
  layer = 'modal',
  showDragHandle = false,
  className,
  overlayClassName,
  testId,
  children,
}) => {
  const containerRef = useFocusTrap<HTMLDivElement>({
    isOpen: open,
    onClose,
    initialFocusRef,
    triggerRef,
    escapeDeactivates: dismissOnEscape,
  });

  if (!open) return null;

  const isSheetLike = variant !== 'center';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-modal={dataModal}
      data-testid={testId}
      tabIndex={-1}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (dismissOnBackdrop) onClose?.();
        else e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (!dismissOnEscape && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={cn(
        'fixed inset-0 flex justify-center bg-theme-overlay/70 backdrop-blur-sm motion-safe:animate-fade-in',
        layer === 'gate' ? 'z-[100]' : 'z-50',
        variant === 'sheet' && 'items-end sm:items-center p-0 sm:p-4',
        variant === 'center' && 'items-center p-4',
        variant === 'palette' && 'items-end sm:items-start p-0 sm:p-4 sm:pt-[12vh]',
        overlayClassName
      )}
    >
      <div
        className={cn(
          'relative flex w-full max-h-[90vh] flex-col overflow-y-auto border border-theme-border-subtle bg-theme-surface p-4 text-theme-text shadow-theme-lg sm:p-6',
          isSheetLike
            ? 'rounded-t-2xl rounded-b-none sm:rounded-theme-xl pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6 motion-safe:animate-sheet-in sm:motion-safe:animate-dialog-in'
            : 'rounded-theme-xl motion-safe:animate-dialog-in',
          SIZE_CLASSES[size],
          className
        )}
      >
        {showDragHandle && (
          <div
            data-testid="bottom-sheet-drag-handle"
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-theme-border sm:hidden"
          />
        )}
        {children}
      </div>
    </div>
  );
};

export interface DialogHeaderProps {
  title: React.ReactNode;
  titleId: string;
  description?: React.ReactNode;
  descriptionId?: string;
  icon?: React.ReactNode;
  /** Renders a close button before the title (first in focus order). */
  onClose?: () => void;
  closeLabel?: string;
  closeTestId?: string;
  actions?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export const DialogHeader: React.FC<DialogHeaderProps> = ({
  title,
  titleId,
  description,
  descriptionId,
  icon,
  onClose,
  closeLabel = 'Close dialog',
  closeTestId,
  actions,
  className,
  sticky = true,
}) => (
  <div
    className={cn(
      'flex items-start gap-3 border-b border-theme-border-subtle pb-4 mb-4',
      sticky &&
        'sticky top-0 z-40 -mx-4 -mt-4 bg-theme-surface/95 px-4 pt-4 backdrop-blur sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6',
      className
    )}
  >
    {onClose && (
      <DialogCloseButton
        onClose={onClose}
        label={closeLabel}
        testId={closeTestId}
        className="order-last -mr-1 -mt-1"
      />
    )}
    {icon && (
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-theme-lg bg-theme-accent/15 text-theme-highlight"
      >
        {icon}
      </span>
    )}
    <div className="min-w-0 flex-1">
      <h2
        id={titleId}
        className="truncate text-lg font-semibold tracking-tight text-theme-text font-theme-heading"
      >
        {title}
      </h2>
      {description && (
        <p id={descriptionId} className="mt-1 text-sm text-theme-text-muted">
          {description}
        </p>
      )}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

export interface DialogCloseButtonProps {
  onClose: () => void;
  label?: string;
  testId?: string;
  className?: string;
}

export const DialogCloseButton: React.FC<DialogCloseButtonProps> = ({
  onClose,
  label = 'Close dialog',
  testId,
  className,
}) => (
  <button
    type="button"
    onClick={onClose}
    aria-label={label}
    data-testid={testId}
    className={cn(
      'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-md text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text',
      focusRing,
      className
    )}
  >
    <X className="h-5 w-5" aria-hidden="true" />
  </button>
);

export const DialogBody: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => <div className={cn('min-h-0 flex-1 space-y-4', className)}>{children}</div>;

export const DialogFooter: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div
    className={cn(
      'mt-6 flex flex-col-reverse gap-2 border-t border-theme-border-subtle pt-4 sm:flex-row sm:justify-end',
      className
    )}
  >
    {children}
  </div>
);
