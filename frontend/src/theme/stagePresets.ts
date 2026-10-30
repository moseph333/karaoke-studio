/**
 * Stage Lyric Presets
 *
 * Karaoke stage presets shared by the live preview, the ASS subtitle exporter and the
 * 1080p video renderer. Each preset's id, name, description, sung/unsung colours (ASS) and
 * duet colours come from the file the backend reads too (backend/assets/shared/
 * stage_presets.json), so the exports cannot drift from the stage. Order is significant:
 * legacy presets keep their indices and new presets are appended, while the Look panel uses
 * STAGE_PRESET_DISPLAY_ORDER.
 */

import stagePresets from '@shared/stage_presets.json';
import { VisualTheme } from '../types';

interface SharedStagePreset {
  id: string;
  name: string;
  description: string;
  primary_color: string;
  secondary_color: string;
  singer2_color?: string;
  both_color?: string;
}

/** Default duet colors, the export's defaults too. */
export const DEFAULT_SINGER2_COLOR = stagePresets.default_duet_colors.singer2;
export const DEFAULT_BOTH_COLOR = stagePresets.default_duet_colors.both;

/** What only the stage shows: preview swatches, the font stack, the backdrop and its tone. */
type StageView = Required<
  Pick<
    VisualTheme,
    | 'previewBg'
    | 'previewSung'
    | 'previewUnsung'
    | 'fontFamily'
    | 'stageBg'
    | 'tone'
    | 'backgroundAccents'
  >
>;

const STAGE_VIEWS: Record<string, StageView> = {
  modern_gold: {
    previewBg: 'from-amber-950/40 to-slate-950',
    previewSung: '#fbbf24',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#17120a',
    tone: 'dark',
    backgroundAccents: ['#f97316', '#fde68a'],
  },
  cyber_cyan: {
    previewBg: 'from-cyan-950/40 to-slate-950',
    previewSung: '#06b6d4',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#061419',
    tone: 'dark',
    backgroundAccents: ['#3b82f6', '#a78bfa'],
  },
  neon_pink: {
    previewBg: 'from-pink-950/40 to-slate-950',
    previewSung: '#ec4899',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#19071a',
    tone: 'dark',
    backgroundAccents: ['#8b5cf6', '#f97316'],
  },
  classic_ktv: {
    previewBg: 'from-blue-950/40 to-slate-950',
    previewSung: '#facc15',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#0a1024',
    tone: 'dark',
    backgroundAccents: ['#3b82f6', '#22d3ee'],
  },
  punk_diy: {
    previewBg: '#0d0d0f',
    previewSung: '#facc15',
    previewUnsung: '#f5f5f5',
    fontFamily: "'Impact', 'Arial Black', sans-serif",
    stageBg: '#0d0d0f',
    tone: 'dark',
    backgroundAccents: ['#ef4444', '#f5f5f5'],
  },
  tape_70s: {
    previewBg: '#1c140e',
    previewSung: '#f59e0b',
    previewUnsung: '#fef3c7',
    fontFamily: "'Georgia', serif",
    stageBg: '#1c140e',
    tone: 'dark',
    backgroundAccents: ['#c44a12', '#fef3c7'],
  },
  crt_ktv: {
    previewBg: '#061309',
    previewSung: '#22c55e',
    previewUnsung: '#86efac',
    fontFamily: "'VT323', monospace",
    stageBg: '#061309',
    tone: 'dark',
    backgroundAccents: ['#14b8a6', '#a3e635'],
  },
  clean_paper: {
    previewBg: '#f4f4f0',
    previewSung: '#dc2626',
    previewUnsung: '#111111',
    fontFamily: "'Space Grotesk', 'Helvetica Neue', sans-serif",
    stageBg: '#f4f4f0',
    tone: 'light',
    backgroundAccents: ['#d97706', '#1f2937'],
  },
  afterglow: {
    previewBg: '#0b0b12',
    previewSung: '#fbbf24',
    previewUnsung: '#edebff',
    fontFamily: "'Sora', 'Inter', sans-serif",
    stageBg: '#0b0b12',
    tone: 'dark',
    backgroundAccents: ['#f472b6', '#5eead4'],
  },
};

export const THEMES: VisualTheme[] = (stagePresets.presets as SharedStagePreset[]).map(
  ({ singer2_color, both_color, ...preset }) => ({
    ...preset,
    ...STAGE_VIEWS[preset.id],
    ...(singer2_color ? { singer2Color: singer2_color } : {}),
    ...(both_color ? { bothColor: both_color } : {}),
  })
);

/** Presentation order for preset pickers (flagship first, legacy indices untouched). */
export const STAGE_PRESET_DISPLAY_ORDER: readonly string[] = [
  'afterglow',
  'modern_gold',
  'cyber_cyan',
  'neon_pink',
  'classic_ktv',
  'punk_diy',
  'tape_70s',
  'crt_ktv',
  'clean_paper',
];

export const STAGE_PRESETS_IN_DISPLAY_ORDER: VisualTheme[] = STAGE_PRESET_DISPLAY_ORDER.map((id) =>
  THEMES.find((t) => t.id === id)
).filter((t): t is VisualTheme => Boolean(t));

export function getStagePreset(id: string | null | undefined): VisualTheme | undefined {
  if (!id) return undefined;
  return THEMES.find((t) => t.id === id);
}

/** Solid backdrop color for a preset (stage preview + video renderer fallback). */
export function getStageBackground(theme: VisualTheme | null | undefined): string {
  if (theme?.stageBg) return theme.stageBg;
  if (theme?.previewBg && /^#[0-9a-f]{6}$/i.test(theme.previewBg)) return theme.previewBg;
  return '#0b0b12';
}
