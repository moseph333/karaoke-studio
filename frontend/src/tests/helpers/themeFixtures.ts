/**
 * Shared theme registry fixtures for theme test suites.
 *
 * Keep theme counts, ordering and defaults in one place so registry growth only
 * needs a single fixture update instead of edits across every suite.
 */
import type { AppThemeId } from '../../types';

export const DEFAULT_APP_THEME_ID: AppThemeId = 'afterglow';
export const DEFAULT_APP_THEME_NAME = 'Afterglow';
export const DEFAULT_APP_THEME_BG = '#0b0b12';
export const DEFAULT_STAGE_PRESET_ID = 'afterglow';

/** Canonical app theme order (APP_THEME_LIST / iterator / picker options). */
export const ALL_APP_THEME_IDS: readonly AppThemeId[] = [
  'afterglow',
  'punk_diy',
  'tape_studio_70s',
  'dive_bar_crt',
  'clean_paper',
];

/** The four original punk/DIY lineup themes whose token values remain pinned. */
export const LEGACY_APP_THEME_IDS: readonly AppThemeId[] = [
  'punk_diy',
  'tape_studio_70s',
  'dive_bar_crt',
  'clean_paper',
];

/** Canonical stage preset order (legacy indices preserved, new presets appended). */
export const ALL_STAGE_PRESET_IDS: readonly string[] = [
  'modern_gold',
  'cyber_cyan',
  'neon_pink',
  'classic_ktv',
  'punk_diy',
  'tape_70s',
  'crt_ktv',
  'clean_paper',
  'afterglow',
];

export const APP_THEME_TO_STAGE_PRESET: Readonly<Record<AppThemeId, string>> = {
  afterglow: 'afterglow',
  punk_diy: 'punk_diy',
  tape_studio_70s: 'tape_70s',
  dive_bar_crt: 'crt_ktv',
  clean_paper: 'clean_paper',
};

export const APP_THEME_BG: Readonly<Record<AppThemeId, string>> = {
  afterglow: '#0b0b12',
  punk_diy: '#0d0d0f',
  tape_studio_70s: '#1a1410',
  dive_bar_crt: '#09080f',
  clean_paper: '#f4f4f0',
};
