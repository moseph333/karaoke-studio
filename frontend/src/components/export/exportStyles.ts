/**
 * Class strings shared by the Export dialog and its section components, so every section
 * card, option row and download button reads as one surface.
 */

import { focusRing } from '../ui/variants';

export const EXPORT_SECTION =
  'space-y-3.5 rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60 p-3.5 shadow-theme-sm sm:p-5';

export const EXPORT_HEADING =
  'flex min-w-0 items-center gap-2.5 font-theme-heading text-sm font-bold text-theme-text sm:text-base';

export const EXPORT_PILL =
  'shrink-0 rounded-theme-pill border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums';

export const EXPORT_OPTION =
  'flex min-h-[44px] min-w-[44px] w-full cursor-pointer select-none items-center gap-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface py-0 pl-0.5 pr-3.5 transition-colors hover:border-theme-border has-[:checked]:border-theme-accent/50 has-[:checked]:bg-theme-accent/10 sm:w-auto';

/** The real, visually transparent checkbox input inside an ExportCheckOption. */
export const EXPORT_CHECKBOX =
  'peer absolute inset-0 m-0 h-full w-full min-h-[44px] min-w-[44px] cursor-pointer appearance-none rounded-theme-md opacity-0';

export const EXPORT_DOWNLOAD_BTN = `flex min-h-[44px] w-full items-center justify-between gap-3 rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised px-4 py-2.5 text-xs font-semibold text-theme-text shadow-theme-sm transition-colors hover:border-theme-border disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm ${focusRing}`;

export const EXPORT_ERROR =
  'break-words rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-2.5 font-mono text-xs text-theme-danger';
