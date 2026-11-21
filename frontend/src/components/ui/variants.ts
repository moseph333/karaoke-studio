/**
 * Design-system class recipes shared by the UI primitives.
 *
 * Everything is flat and square: no gradient, shadow or radius. Buttons speak in marquee
 * capitals (the ks-display class). Yellow is kept for the primary action and for what is on.
 *
 * Every interactive recipe keeps a 44px minimum touch target on small screens and
 * tightens to a compact desktop size through `md:` variants.
 */

export const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus focus-visible:ring-offset-2 focus-visible:ring-offset-theme-bg';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive';

export type ButtonSize = 'sm' | 'md' | 'lg';

export const buttonBase = `ks-display inline-flex min-w-[44px] items-center justify-center gap-2 whitespace-nowrap select-none transition-[background-color,border-color,color,filter] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export const buttonVariants: Record<ButtonVariant, string> = {
  // The one action that moves the song forward on a screen
  primary:
    'bg-theme-accent text-theme-accent-text border border-theme-accent hover:bg-theme-accent-hover hover:border-theme-accent-hover',
  secondary:
    'bg-transparent text-theme-text border border-theme-border hover:bg-theme-text hover:text-theme-text-inverse',
  ghost:
    'bg-transparent text-theme-text-muted border border-transparent hover:text-theme-text hover:bg-theme-surface-subtle',
  danger:
    'bg-transparent text-theme-danger border border-theme-danger hover:bg-theme-danger hover:text-theme-text-inverse',
  destructive:
    'bg-theme-danger text-theme-text-inverse border border-theme-danger hover:brightness-110',
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] md:min-h-[32px] px-3 text-[20px]',
  md: 'min-h-[44px] md:min-h-[40px] px-4 text-[22px]',
  lg: 'min-h-[48px] px-5 text-[26px]',
};

export type IconButtonVariant = 'ghost' | 'subtle' | 'solid' | 'outline' | 'overlay';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export const iconButtonBase = `relative inline-flex shrink-0 items-center justify-center transition-[background-color,border-color,color] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

export const iconButtonVariants: Record<IconButtonVariant, string> = {
  ghost:
    'bg-transparent text-theme-text-muted border border-transparent hover:text-theme-text hover:bg-theme-surface-subtle',
  subtle:
    'bg-theme-surface-subtle text-theme-text border border-transparent hover:bg-theme-surface-raised',
  solid:
    'bg-theme-accent text-theme-accent-text border border-theme-accent hover:bg-theme-accent-hover',
  outline:
    'bg-transparent text-theme-text border border-theme-border hover:bg-theme-text hover:text-theme-text-inverse',
  // On top of the stage video, where the page's own colours do not apply
  overlay:
    'bg-black/45 text-white border border-white/15 backdrop-blur-md hover:bg-black/60 hover:border-white/30',
};

/** A toggle that is on is lit: solid yellow, never a tint. */
const pressedOn =
  'bg-theme-accent text-theme-accent-text border-theme-accent hover:bg-theme-accent-hover hover:text-theme-accent-text';

export const iconButtonPressed: Record<IconButtonVariant, string> = {
  ghost: pressedOn,
  subtle: pressedOn,
  solid: 'ring-2 ring-theme-text',
  outline: pressedOn,
  overlay: 'bg-white/20 text-white border-white/50',
};

export const iconButtonSizes: Record<IconButtonSize, string> = {
  sm: 'min-h-[44px] min-w-[44px] md:min-h-[32px] md:min-w-[32px]',
  md: 'min-h-[44px] min-w-[44px] md:min-h-[38px] md:min-w-[38px]',
  lg: 'min-h-[48px] min-w-[48px] w-12 h-12',
};

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

/** A badge is a few words in a colour, without a pill behind it. */
export const badgeTones: Record<BadgeTone, string> = {
  neutral: 'text-theme-text-muted',
  accent: 'text-theme-accent',
  success: 'text-theme-success',
  warning: 'text-theme-warning',
  danger: 'text-theme-danger',
};

/** Surface recipes shared by panels and cards. */
export const surfaceVariants = {
  surface: 'bg-theme-surface border border-theme-border-subtle',
  raised: 'bg-theme-surface-raised border border-theme-border-subtle',
  inset: 'bg-theme-surface-subtle border border-theme-border-subtle',
} as const;

export type SurfaceVariant = keyof typeof surfaceVariants;
