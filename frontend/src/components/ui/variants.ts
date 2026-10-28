/**
 * Design-system class recipes shared by the UI primitives.
 *
 * Every interactive recipe keeps a 44px minimum touch target on small screens and
 * tightens to a compact desktop size through `md:` variants.
 */

export const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg';

export type ButtonVariant =
  | 'primary'
  | 'gradient'
  | 'secondary'
  | 'subtle'
  | 'ghost'
  | 'outline'
  | 'danger'
  | 'destructive'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonBase = `inline-flex min-w-[44px] items-center justify-center gap-2 font-semibold whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,transform,filter] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${focusRing}`;

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-theme-accent text-theme-accent-text border border-transparent shadow-theme-sm hover:bg-theme-accent-hover',
  gradient:
    'bg-gradient-accent text-theme-accent-text border border-transparent shadow-theme-glow hover:brightness-110',
  secondary:
    'bg-theme-surface-raised text-theme-text border border-theme-border-subtle hover:border-theme-border hover:bg-theme-surface-subtle',
  subtle:
    'bg-theme-surface-subtle text-theme-text border border-transparent hover:bg-theme-surface-raised',
  ghost:
    'bg-transparent text-theme-text-muted border border-transparent hover:text-theme-text hover:bg-theme-surface-subtle',
  outline:
    'bg-transparent text-theme-text border border-theme-border hover:bg-theme-surface-subtle hover:border-theme-text-muted',
  danger:
    'bg-theme-danger/10 text-theme-danger border border-theme-danger/40 hover:bg-theme-danger/20 hover:border-theme-danger/60',
  destructive:
    'bg-theme-danger text-theme-text-inverse border border-transparent shadow-theme-sm hover:brightness-110',
  success:
    'bg-theme-success/15 text-theme-success border border-theme-success/40 hover:bg-theme-success/25',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] md:min-h-[32px] px-3 text-xs rounded-theme-md',
  md: 'min-h-[44px] md:min-h-[40px] px-4 text-sm rounded-theme-md',
  lg: 'min-h-[48px] px-5 text-base rounded-theme-lg',
};

export type IconButtonVariant = 'ghost' | 'subtle' | 'solid' | 'outline' | 'overlay' | 'gradient';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export const iconButtonBase = `relative inline-flex shrink-0 items-center justify-center transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${focusRing}`;

export const iconButtonVariants: Record<IconButtonVariant, string> = {
  ghost:
    'bg-transparent text-theme-text-muted border border-transparent hover:text-theme-text hover:bg-theme-surface-subtle',
  subtle:
    'bg-theme-surface-subtle text-theme-text border border-theme-border-subtle hover:bg-theme-surface-raised hover:border-theme-border',
  solid:
    'bg-theme-accent text-theme-accent-text border border-transparent hover:bg-theme-accent-hover',
  outline:
    'bg-transparent text-theme-text border border-theme-border hover:bg-theme-surface-subtle',
  overlay:
    'bg-black/45 text-white border border-white/15 backdrop-blur-md hover:bg-black/60 hover:border-white/30',
  gradient:
    'bg-gradient-accent text-theme-accent-text border border-transparent shadow-theme-glow hover:brightness-110',
};

export const iconButtonPressed: Record<IconButtonVariant, string> = {
  ghost: 'bg-theme-accent/15 text-theme-highlight border-theme-accent/40',
  subtle: 'bg-theme-accent/15 text-theme-highlight border-theme-accent/50',
  solid: 'ring-2 ring-theme-highlight/60',
  outline: 'bg-theme-accent/15 text-theme-highlight border-theme-accent/60',
  overlay: 'bg-white/20 text-white border-white/50',
  gradient: 'ring-2 ring-white/40',
};

export const iconButtonSizes: Record<IconButtonSize, string> = {
  sm: 'min-h-[44px] min-w-[44px] md:min-h-[32px] md:min-w-[32px] rounded-theme-md',
  md: 'min-h-[44px] min-w-[44px] md:min-h-[38px] md:min-w-[38px] rounded-theme-md',
  lg: 'min-h-[48px] min-w-[48px] w-12 h-12 rounded-theme-pill',
};

export type BadgeTone =
  'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'gradient';

export const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-theme-surface-raised text-theme-text-muted border-theme-border-subtle',
  accent: 'bg-theme-accent/15 text-theme-highlight border-theme-accent/40',
  success: 'bg-theme-success/15 text-theme-success border-theme-success/35',
  warning: 'bg-theme-warning/15 text-theme-warning border-theme-warning/35',
  danger: 'bg-theme-danger/15 text-theme-danger border-theme-danger/35',
  info: 'bg-theme-info/15 text-theme-info border-theme-info/35',
  gradient: 'bg-gradient-accent text-theme-accent-text border-transparent',
};

/** Surface recipes shared by panels and cards. */
export const surfaceVariants = {
  surface: 'bg-theme-surface border border-theme-border-subtle shadow-theme-md',
  raised: 'bg-theme-surface-raised border border-theme-border-subtle shadow-theme-md',
  glass: 'ks-glass border border-theme-border-subtle shadow-theme-lg',
  inset: 'bg-theme-surface-subtle border border-theme-border-subtle',
} as const;

export type SurfaceVariant = keyof typeof surfaceVariants;

/** Visually hidden but available to assistive technology. */
export const srOnly = 'sr-only';
