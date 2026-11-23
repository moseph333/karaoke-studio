/**
 * Persisted stage settings
 *
 * The studio remembers the stage look, each look's own colour choices, the lyric size, format,
 * background style and upload, highlight mode and the preview toggles across reloads.
 * Everything read back is validated, so a stale or hand-edited entry falls back to defaults
 * field by field.
 *
 * Settings saved before the five looks (under the v1 key, with one of the nine presets) are
 * read once and carried over: the preset becomes the look nearest it and its colour choices
 * go with that look. The old entry is left where it is.
 */

import { SyncDisplayMode } from '../types';
import { STAGE_LOOKS, getStageLook, isLookId, legacyLook, type LookId } from './stageLooks';
import {
  DEFAULT_STAGE_BACKGROUND_STYLE,
  StageBackgroundStyle,
  isStageBackgroundStyle,
} from './stageBackgrounds';

export const STAGE_SETTINGS_STORAGE_KEY = 'karaoke_stage_settings_v2';
/** Where settings were kept while the stage had nine presets. */
export const LEGACY_STAGE_SETTINGS_KEY = 'karaoke_stage_settings_v1';

export const STAGE_SIZES = ['compact', 'standard', 'large'] as const;
export type StageSize = (typeof STAGE_SIZES)[number];

export const FONT_SCALE_RANGE = { min: 0.5, max: 2 } as const;

/** The colours a user chose for one look; null leaves the look's own. */
export interface LookColors {
  sung: string | null;
  unsung: string | null;
  singer2: string | null;
  both: string | null;
}

export const NO_LOOK_COLORS: LookColors = { sung: null, unsung: null, singer2: null, both: null };

export interface StageSettings {
  /** The look last shown; null until a stage has been opened. */
  lookId: LookId | null;
  /** Colour choices, kept per look: a colour picked on one ground rarely suits another. */
  colors: Partial<Record<LookId, LookColors>>;
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
  lookId: null,
  colors: {},
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

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function lookColors(raw: unknown): LookColors | null {
  const src = record(raw);
  const colors: LookColors = {
    sung: color(src.sung),
    unsung: color(src.unsung),
    singer2: color(src.singer2),
    both: color(src.both),
  };
  return Object.values(colors).some(Boolean) ? colors : null;
}

/** The settings every version stores the same way. */
function sharedSettings(src: Record<string, unknown>): Omit<StageSettings, 'lookId' | 'colors'> {
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

/** Validates an unknown stored value into complete settings. */
export function sanitizeStageSettings(raw: unknown): StageSettings {
  const src = record(raw);
  const stored = record(src.colors);
  const colors: StageSettings['colors'] = {};
  for (const look of STAGE_LOOKS) {
    const chosen = lookColors(stored[look.id]);
    if (chosen) colors[look.id] = chosen;
  }
  return { lookId: isLookId(src.lookId) ? src.lookId : null, colors, ...sharedSettings(src) };
}

/**
 * Settings saved under one of the nine presets, as settings for the looks: the preset becomes
 * the look nearest it, the colours the user picked go with that look, and a preset that was
 * only a colour (Cyber Cyan, Neon Sunset) carries its sung colour over when none was picked.
 * A preset this app never had leaves the look unset, so the default look shows.
 */
export function migrateLegacyStageSettings(raw: unknown): StageSettings {
  const src = record(raw);
  const legacy = legacyLook(src.presetId);
  const lookId = legacy
    ? getStageLook(src.presetId).id
    : isLookId(src.presetId)
      ? src.presetId
      : null;
  const colors: StageSettings['colors'] = {};
  if (lookId) {
    const chosen: LookColors = {
      sung: color(src.customSungColor) ?? color(legacy?.carry_sung),
      unsung: color(src.customUnsungColor),
      singer2: color(src.singer2Color),
      both: color(src.bothColor),
    };
    if (Object.values(chosen).some(Boolean)) colors[lookId] = chosen;
  }
  return { lookId, colors, ...sharedSettings(src) };
}

/** Reads saved settings (carrying over the ones from before the looks), or null when nothing
 * valid is stored or storage is blocked. */
export function loadStageSettings(): StageSettings | null {
  try {
    const raw = window.localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY);
    if (raw) return sanitizeStageSettings(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_STAGE_SETTINGS_KEY);
    return legacy ? migrateLegacyStageSettings(JSON.parse(legacy)) : null;
  } catch {
    return null;
  }
}

export function saveStageSettings(settings: StageSettings): void {
  try {
    window.localStorage.setItem(
      STAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: 2, ...sanitizeStageSettings(settings) })
    );
  } catch {
    // Private mode / quota: settings simply won't persist
  }
}
