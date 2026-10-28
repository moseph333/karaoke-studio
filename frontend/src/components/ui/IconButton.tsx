import React from 'react';
import { cn } from '../../utils/cn';
import { Tooltip, TooltipProps } from '../Tooltip';
import {
  IconButtonSize,
  IconButtonVariant,
  iconButtonBase,
  iconButtonPressed,
  iconButtonSizes,
  iconButtonVariants,
} from './variants';

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  icon: React.ReactNode;
  /** Accessible name (rendered as aria-label). */
  label: string;
  /** Tooltip text; defaults to the label. Pass false to disable the tooltip. */
  tooltip?: React.ReactNode | false;
  tooltipPosition?: TooltipProps['position'];
  tooltipAlign?: TooltipProps['align'];
  hotkey?: string | string[];
  /** Toggle state; renders aria-pressed when defined. */
  pressed?: boolean;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Small corner badge (e.g. unsaved dot). */
  badge?: React.ReactNode;
  /** Class applied to the tooltip wrapper. */
  wrapperClassName?: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      tooltip,
      tooltipPosition = 'top',
      tooltipAlign,
      hotkey,
      pressed,
      variant = 'ghost',
      size = 'md',
      badge,
      wrapperClassName,
      className,
      type = 'button',
      ...rest
    },
    ref
  ) => {
    const button = (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : pressed}
        className={cn(
          iconButtonBase,
          iconButtonVariants[variant],
          iconButtonSizes[size],
          pressed && iconButtonPressed[variant],
          className
        )}
        {...rest}
      >
        {icon}
        {badge}
      </button>
    );
    if (tooltip === false) return button;
    return (
      <Tooltip
        content={tooltip ?? label}
        hotkey={hotkey}
        position={tooltipPosition}
        align={tooltipAlign}
        className={wrapperClassName}
      >
        {button}
      </Tooltip>
    );
  }
);
IconButton.displayName = 'IconButton';
