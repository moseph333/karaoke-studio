/** Class recipes for the lyric timeline editor */

import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

export const S_ADD_LINE_BTN = cn(
  'ks-display flex min-h-[44px] w-full items-center justify-center gap-2 px-3 py-2',
  'text-[20px] text-theme-text-muted transition-colors hover:text-theme-text md:min-h-[36px]',
  focusRing
);

export const S_RESUME_PILL = cn(
  'absolute bottom-3 left-1/2 z-10 inline-flex min-h-[44px] -translate-x-1/2 items-center gap-2 border-2 border-theme-border px-3.5',
  'bg-theme-bg text-sm font-semibold text-theme-text transition-colors hover:bg-theme-surface-raised',
  'motion-safe:animate-fade-in md:min-h-[32px]',
  focusRing
);

export const S_SCROLL_AREA = cn(
  '-mx-1 max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain scroll-smooth px-1 py-0.5 touch-pan-y',
  // The editor drives scrolling itself, so opt out of browser scroll anchoring
  'studio:max-h-none studio:min-h-0 studio:flex-1 [overflow-anchor:none]',
  focusRing
);
