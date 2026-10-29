/**
 * Persisted stage settings
 *
 * The studio remembers the stage look (preset, colors, lyric size, format, background style
 * and upload, highlight mode) and preview toggles across reloads. Everything read back is validated, so
 * a stale or hand-edited entry falls back to defaults field by field.
 */

import { SyncDisplayMode } from '../types';
import { getStagePreset } from './stagePresets';
import {
  DEFAULT_STAGE_BACKGROUND_STYLE,
  StageBackgroundStyle,
  isStageBackgroundStyle,
} from './stageBackgrounds';

export const STAGE_SETTINGS_STORAGE_KEY = 'karaoke_stage_settings_v1';

export const STAGE_SIZES = ['compact', 'standard', 'large'] as const;
export type StageSize = (typeof STAGE_SIZES)[number];

export const FONT_SCALE_RANGE = { min: 0.5, max: 2 } as const;

export interface StageSettings {
  presetId: string | null;
  /** 'user' when picked in the Look panel; 'app' when it follows the app theme. */
  presetSource: 'user' | 'app';
  customSungColor: string | null;
  customUnsungColor: string | null;
  singer2Color: string | null;
  bothColor: string | null;
  fontSizeScale: number;
  aspectRatio: '16:9' | '9:16';
  syncMode: SyncDisplayMode;
  /** What the stage and exports show behind the lyrics; 'custom' is the uploaded file. */
  backgroundStyle: StageBackgroundStyle;
  customBgId: string;
  showVisualizer: boolean;
  showChordBar: boolean;
  stageSize: StageSize;
}

export const DEFAULT_STAGE_SETTINGS: StageSettings = {
  presetId: null,
  presetSource: 'app',
  customSungColor: null,
  customUnsungColor: null,
  singer2Color: null,
  bothColor: null,
  fontSizeScale: 1,
  aspectRatio: '16:9',
  syncMode: 'word',
  backgroundStyle: DEFAULT_STAGE_BACKGROUND_STYLE,
  customBgId: '',
  showVisualizer: false,
  showChordBar: false,
  stageSize: 'standard',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Uploaded background ids are bare file names (see /api/upload-background)
const BACKGROUND_ID = /^[\w.-]{1,255}$/;

const color = (value: unknown): string | null =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null;

/** Validates an unknown stored value into complete settings. */
export function sanitizeStageSettings(raw: unknown): StageSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const presetId =
    typeof src.presetId === 'string' && getStagePreset(src.presetId) ? src.presetId : null;
  const scale = typeof src.fontSizeScale === 'number' ? src.fontSizeScale : NaN;
  const customBgId =
    typeof src.customBgId === 'string' && BACKGROUND_ID.test(src.customBgId) ? src.customBgId : '';
  // Settings saved before background styles existed keep showing their upload
  const storedStyle = isStageBackgroundStyle(src.backgroundStyle)
    ? src.backgroundStyle
    : customBgId
      ? 'custom'
      : DEFAULT_STAGE_BACKGROUND_STYLE;
  return {
    presetId,
    presetSource: presetId && src.presetSource === 'user' ? 'user' : 'app',
    customSungColor: color(src.customSungColor),
    customUnsungColor: color(src.customUnsungColor),
    singer2Color: color(src.singer2Color),
    bothColor: color(src.bothColor),
    fontSizeScale:
      Number.isFinite(scale) && scale >= FONT_SCALE_RANGE.min && scale <= FONT_SCALE_RANGE.max
        ? scale
        : DEFAULT_STAGE_SETTINGS.fontSizeScale,
    aspectRatio: src.aspectRatio === '9:16' ? '9:16' : '16:9',
    syncMode: src.syncMode === 'line' ? 'line' : 'word',
    backgroundStyle:
      storedStyle === 'custom' && !customBgId ? DEFAULT_STAGE_BACKGROUND_STYLE : storedStyle,
    customBgId,
    showVisualizer: src.showVisualizer === true,
    showChordBar: src.showChordBar === true,
    stageSize: STAGE_SIZES.includes(src.stageSize as StageSize)
      ? (src.stageSize as StageSize)
      : DEFAULT_STAGE_SETTINGS.stageSize,
  };
}

/** Reads saved settings, or null when nothing (valid JSON) is stored or storage is blocked. */
export function loadStageSettings(): StageSettings | null {
  try {
    const raw = window.localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return sanitizeStageSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveStageSettings(settings: StageSettings): void {
  try {
    window.localStorage.setItem(
      STAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: 1, ...sanitizeStageSettings(settings) })
    );
  } catch {
    // Private mode / quota: settings simply won't persist
  }
}
