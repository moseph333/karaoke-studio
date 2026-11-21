/**
 * Class strings shared by the Export dialog and its section components: a section sits
 * under a rule with no box of its own, and only its controls are outlined.
 */

import { focusRing } from '../ui/variants';

export const EXPORT_SECTION =
  'space-y-3.5 border-t-2 border-theme-border pt-4 first:border-t-0 first:pt-0';

export const EXPORT_HEADING = 'ks-display min-w-0 text-[28px] font-black text-theme-text';

/** A count or format beside a section heading, as plain text. */
export const EXPORT_NOTE = 'shrink-0 text-sm tabular-nums text-theme-text-muted';

export const EXPORT_OPTION =
  '-ml-3 flex min-h-[44px] min-w-[44px] w-full cursor-pointer select-none items-center gap-0.5 pr-3.5 sm:w-auto';

/** The real, visually transparent checkbox input inside an ExportCheckOption. */
export const EXPORT_CHECKBOX =
  'peer absolute inset-0 m-0 h-full w-full min-h-[44px] min-w-[44px] cursor-pointer appearance-none opacity-0';

export const EXPORT_DOWNLOAD_BTN = `flex min-h-[44px] w-full items-center justify-between gap-3 border border-theme-border px-4 py-2.5 text-sm font-semibold text-theme-text transition-colors hover:bg-theme-surface-raised disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export const EXPORT_ERROR = 'break-words text-sm font-semibold text-theme-danger';
