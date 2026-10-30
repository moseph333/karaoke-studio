/**
 * Stage Lyric Presets
 *
 * Karaoke stage presets shared by the live preview, the ASS subtitle exporter and the
 * 1080p video renderer. Order is significant: legacy presets keep their indices and new
 * presets are appended, while the Look panel uses STAGE_PRESET_DISPLAY_ORDER.
 */

import { VisualTheme } from '../types';

/** Default duet colors (mirrors backend ass_generator defaults: #FF00B3 / #7BFA50). */
export const DEFAULT_SINGER2_COLOR = '#ff00b3';
export const DEFAULT_BOTH_COLOR = '#7bfa50';

export const THEMES: VisualTheme[] = [
  {
    id: 'modern_gold',
    name: 'Modern Gold',
    description: 'Crisp white transitioning into warm radiant gold',
    primary_color: '&H0000D7FF', // BGR in ASS: FF D7 00 = Gold
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-amber-950/40 to-slate-950',
    previewSung: '#fbbf24',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#17120a',
    tone: 'dark',
    backgroundAccents: ['#f97316', '#fde68a'],
  },
  {
    id: 'cyber_cyan',
    name: 'Cyber Cyan',
    description: 'Electric cyan glowing wipe on ambient dark backdrop',
    primary_color: '&H00FFFF00', // BGR in ASS: 00 FF FF = Cyan
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-cyan-950/40 to-slate-950',
    previewSung: '#06b6d4',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#061419',
    tone: 'dark',
    backgroundAccents: ['#3b82f6', '#a78bfa'],
  },
  {
    id: 'neon_pink',
    name: 'Neon Sunset',
    description: 'Vivid magenta sweep with high contrast',
    primary_color: '&H00B300FF', // BGR in ASS: FF 00 B3 = Neon Magenta
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-pink-950/40 to-slate-950',
    previewSung: '#ec4899',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#19071a',
    tone: 'dark',
    backgroundAccents: ['#8b5cf6', '#f97316'],
  },
  {
    id: 'classic_ktv',
    name: 'Classic KTV',
    description: 'Traditional karaoke blue-to-yellow karaoke look',
    primary_color: '&H0000FFFF', // BGR in ASS: FF FF 00 = Yellow
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-blue-950/40 to-slate-950',
    previewSung: '#facc15',
    previewUnsung: '#ffffff',
    fontFamily: 'Montserrat, sans-serif',
    stageBg: '#0a1024',
    tone: 'dark',
    backgroundAccents: ['#3b82f6', '#22d3ee'],
  },
  {
    id: 'punk_diy',
    name: 'Basement Flyer',
    description: 'Gritty Xerox black with raw flyer-yellow wipe and bold typography',
    primary_color: '&H0015CCFA',
    secondary_color: '&H00F5F5F5',
    previewBg: '#0d0d0f',
    previewSung: '#facc15',
    previewUnsung: '#f5f5f5',
    fontFamily: "'Impact', 'Arial Black', sans-serif",
    stageBg: '#0d0d0f',
    tone: 'dark',
    backgroundAccents: ['#ef4444', '#f5f5f5'],
  },
  {
    id: 'tape_70s',
    name: "Reel-to-Reel '74",
    description: 'Teak console with warm amber VU meter glow and sepia cream',
    primary_color: '&H000B9EF5',
    secondary_color: '&H00C7F3FE',
    previewBg: '#1c140e',
    previewSung: '#f59e0b',
    previewUnsung: '#fef3c7',
    fontFamily: "'Georgia', serif",
    stageBg: '#1c140e',
    tone: 'dark',
    backgroundAccents: ['#c44a12', '#fef3c7'],
  },
  {
    id: 'crt_ktv',
    name: 'Midnight KTV Booth',
    description: 'Phosphor green scanline CRT glow with retro arcade raster font',
    primary_color: '&H005EC522',
    secondary_color: '&H00ACEF86',
    previewBg: '#061309',
    previewSung: '#22c55e',
    previewUnsung: '#86efac',
    fontFamily: "'VT323', monospace",
    stageBg: '#061309',
    tone: 'dark',
    backgroundAccents: ['#14b8a6', '#a3e635'],
  },
  {
    id: 'clean_paper',
    name: 'Monolith Press',
    description: 'Brutalist Swiss drafting paper with razor-sharp editorial red and black ink',
    primary_color: '&H002626DC',
    secondary_color: '&H00111111',
    previewBg: '#f4f4f0',
    previewSung: '#dc2626',
    previewUnsung: '#111111',
    fontFamily: "'Space Grotesk', 'Helvetica Neue', sans-serif",
    stageBg: '#f4f4f0',
    tone: 'light',
    backgroundAccents: ['#d97706', '#1f2937'],
  },
  {
    id: 'afterglow',
    name: 'Afterglow',
    description: 'Ink-black stage with a warm gold sweep and violet-to-rose duet glow',
    primary_color: '&H0024BFFB', // BGR in ASS: FB BF 24 = Warm Gold
    secondary_color: '&H00FFEBED', // BGR in ASS: ED EB FF = Lilac White
    previewBg: '#0b0b12',
    previewSung: '#fbbf24',
    previewUnsung: '#edebff',
    fontFamily: "'Sora', 'Inter', sans-serif",
    stageBg: '#0b0b12',
    tone: 'dark',
    singer2Color: '#f472b6',
    bothColor: '#5eead4',
    backgroundAccents: ['#f472b6', '#5eead4'],
  },
];

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
