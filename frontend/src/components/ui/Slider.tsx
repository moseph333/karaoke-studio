import React, { useRef } from 'react';
import { cn } from '../../utils/cn';

/** Props a wrapping Tooltip (or other enhancer) may inject; forwarded to the input. */
type ForwardedInputProps = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onFocus' | 'onBlur' | 'onMouseEnter' | 'onMouseLeave' | 'onClick' | 'aria-describedby' | 'title'
>;

export interface SliderProps extends ForwardedInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Fires once the user finishes an interaction (pointer up, key up, blur). */
  onChangeEnd?: (value: number) => void;
  valueText?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  testId?: string;
  tone?: 'accent' | 'sung' | 'success';
  className?: string;
}

const TONE_COLORS: Record<NonNullable<SliderProps['tone']>, string> = {
  accent: 'rgb(var(--theme-accent-rgb))',
  sung: 'rgb(var(--theme-sung-rgb))',
  success: 'rgb(var(--theme-success-rgb))',
};

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onChangeEnd,
  valueText,
  disabled = false,
  id,
  testId,
  tone = 'accent',
  className,
  onBlur,
  ...forwarded
}) => {
  const lastCommitted = useRef<number>(value);
  const clamped = Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  const fill = max > min ? ((clamped - min) / (max - min)) * 100 : 0;

  const commit = (v: number) => {
    if (!onChangeEnd || v === lastCommitted.current) return;
    lastCommitted.current = v;
    onChangeEnd(v);
  };

  return (
    <input
      {...forwarded}
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={clamped}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText ? valueText(clamped) : undefined}
      data-testid={testId}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onChange(v);
      }}
      onPointerUp={(e) => commit(parseFloat((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => commit(parseFloat((e.target as HTMLInputElement).value))}
      onBlur={(e) => {
        commit(parseFloat(e.target.value));
        onBlur?.(e);
      }}
      style={
        {
          '--ks-range-fill': `${fill.toFixed(2)}%`,
          '--ks-range-color': TONE_COLORS[tone],
        } as React.CSSProperties
      }
      className={cn('ks-range min-h-[44px] md:min-h-[28px] w-full', className)}
    />
  );
};
