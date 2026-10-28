import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { EXPORT_CHECKBOX, EXPORT_OPTION } from './exportStyles';

export interface ExportCheckOptionProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  containerTestId: string;
}

/**
 * A labelled export option. The native checkbox stays the real control and covers a 44px hit
 * area; the themed box beside it only draws the state.
 */
export const ExportCheckOption: React.FC<ExportCheckOptionProps> = ({
  label,
  checked,
  onChange,
  testId,
  containerTestId,
}) => (
  <label data-testid={containerTestId} className={EXPORT_OPTION}>
    <span className="relative inline-grid h-11 w-11 shrink-0 place-items-center">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className={EXPORT_CHECKBOX}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none grid h-5 w-5 place-items-center rounded-[6px] border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-theme-focus peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-theme-bg',
          checked
            ? 'border-transparent bg-theme-accent text-theme-accent-text'
            : 'border-theme-border bg-theme-surface-subtle'
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </span>
    <span className="text-xs font-medium text-theme-text sm:text-sm">{label}</span>
  </label>
);
