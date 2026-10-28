import React, { useRef } from 'react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  ariaLabel?: string;
  title?: string;
  testId?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** radio = radiogroup with roving focus; toggle = group of aria-pressed buttons. */
  semantics?: 'radio' | 'toggle';
  ariaLabel: string;
  size?: 'sm' | 'md';
  tone?: 'accent' | 'neutral';
  fullWidth?: boolean;
  testId?: string;
  className?: string;
  optionClassName?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  semantics = 'toggle',
  ariaLabel,
  size = 'md',
  tone = 'accent',
  fullWidth = false,
  testId,
  className,
  optionClassName,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isRadio = semantics === 'radio';

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!isRadio) return;
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    const pos = enabled.indexOf(index);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next >= 0) {
      e.preventDefault();
      onChange(options[next].value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role={isRadio ? 'radiogroup' : 'group'}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle p-1',
        fullWidth && 'flex w-full',
        className
      )}
    >
      {options.map((opt, index) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={isRadio ? 'radio' : undefined}
            aria-checked={isRadio ? active : undefined}
            aria-pressed={isRadio ? undefined : active}
            aria-label={opt.ariaLabel}
            title={opt.title}
            tabIndex={isRadio ? (active ? 0 : -1) : undefined}
            disabled={opt.disabled}
            data-testid={opt.testId}
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-theme-md font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm'
                ? 'min-h-[44px] md:min-h-[30px] px-2.5 text-xs'
                : 'min-h-[44px] md:min-h-[36px] px-3 text-sm',
              fullWidth && 'flex-1',
              active
                ? tone === 'accent'
                  ? 'bg-theme-accent text-theme-accent-text shadow-theme-sm'
                  : 'bg-theme-surface-raised text-theme-text shadow-theme-sm'
                : 'text-theme-text-muted hover:bg-theme-surface-raised/60 hover:text-theme-text',
              focusRing,
              optionClassName
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
