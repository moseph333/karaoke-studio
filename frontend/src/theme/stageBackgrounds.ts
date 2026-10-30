/**
 * Stage background styles
 *
 * What the stage shows behind the lyrics, drawn alike by the live preview and the video
 * renderer (backend/services/stage_backgrounds.py). Motion is a pure function of the song
 * time, using the numbers in background_motion.json, which the renderer reads too, so a
 * paused or scrubbed stage shows the frame the export renders then.
 */

import motion from '@shared/background_motion.json';
import { VisualTheme } from '../types';

export const STAGE_BACKGROUND_STYLES = [
  'artwork',
  'drift',
  'aurora',
  'spectrum',
  'color',
  'custom',
] as const;
export type StageBackgroundStyle = (typeof STAGE_BACKGROUND_STYLES)[number];
export const DEFAULT_STAGE_BACKGROUND_STYLE: StageBackgroundStyle = 'artwork';

export interface StageBackgroundOption {
  value: Exclude<StageBackgroundStyle, 'custom'>;
  label: string;
  hint: string;
  /** Shows the song's cover art (songs without art get the plain stage colour). */
  needsArtwork?: boolean;
  /** Moves with the song. */
  moves?: boolean;
}

export const STAGE_BACKGROUND_OPTIONS: readonly StageBackgroundOption[] = [
  {
    value: 'artwork',
    label: 'Cover art',
    hint: "The song's cover art, blurred",
    needsArtwork: true,
  },
  {
    value: 'drift',
    label: 'Drifting art',
    hint: 'The blurred cover art slowly pans',
    needsArtwork: true,
    moves: true,
  },
  {
    value: 'aurora',
    label: 'Aurora',
    hint: 'Soft glowing orbs in the preset colours',
    moves: true,
  },
  { value: 'spectrum', label: 'Spectrum', hint: 'A glow that rises with the music', moves: true },
  { value: 'color', label: 'Plain', hint: 'Just the stage colour' },
];

export function isStageBackgroundStyle(value: unknown): value is StageBackgroundStyle {
  return STAGE_BACKGROUND_STYLES.includes(value as StageBackgroundStyle);
}

/** Styles the renderer draws over the stage colour from the palette and tone. */
export function isGeneratedStyle(style: StageBackgroundStyle): boolean {
  return style === 'aurora' || style === 'spectrum';
}

/** Export frame size per format (the motion is defined against it). */
export const VIDEO_SIZE: Record<'16:9' | '9:16', readonly [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
};

const TAU = 2 * Math.PI;

// --- Drifting art --------------------------------------------------------------------------

/** The drift still's size: the video size times the overscan, rounded to even pixels. */
export function overscanSize(width: number, height: number): [number, number] {
  const { overscan } = motion.drift;
  return [Math.round((width * overscan) / 2) * 2, Math.round((height * overscan) / 2) * 2];
}

/** Where the drift window sits at song time t, from -1 to 1 on each axis. */
export function driftOffset(time: number): { x: number; y: number } {
  const { periodX, periodY, phaseY } = motion.drift;
  return {
    x: Math.sin((TAU * time) / periodX),
    y: Math.sin((TAU * time) / periodY + phaseY),
  };
}

/**
 * Size, position and transform of the drift still on the stage. The still is larger than the
 * frame by the overscan ratio; the export crops a window that slides across it, which looks
 * the same as sliding the still the other way (percentages here refer to the still itself).
 */
export function driftLayer(
  time: number,
  aspect: '16:9' | '9:16'
): { width: string; height: string; left: string; top: string; transform: string } {
  const [width, height] = VIDEO_SIZE[aspect];
  const [overWidth, overHeight] = overscanSize(width, height);
  const kx = overWidth / width;
  const ky = overHeight / height;
  const { x, y } = driftOffset(time);
  const pct = (value: number) => `${(value * 100).toFixed(4)}%`;
  return {
    width: pct(kx),
    height: pct(ky),
    left: pct(-(kx - 1) / 2),
    top: pct(-(ky - 1) / 2),
    transform: `translate3d(${pct((-(kx - 1) / (2 * kx)) * x)}, ${pct((-(ky - 1) / (2 * ky)) * y)}, 0)`,
  };
}

// --- Aurora -------------------------------------------------------------------------------

export const AURORA_ORB_COUNT = motion.aurora.orbs.length;

/** Centre of orb i at song time t, as fractions of the stage width and height. */
export function orbCentre(index: number, time: number): { x: number; y: number } {
  const orb = motion.aurora.orbs[index];
  return {
    x: orb.x + orb.ax * Math.sin((TAU * time) / orb.periodX + orb.phaseX),
    y: orb.y + orb.ay * Math.sin((TAU * time) / orb.periodY + orb.phaseY),
  };
}

/** Side of an orb's square, in px, for a stage of the given size. */
export function orbSize(width: number, height: number): number {
  const { sigma, extent } = motion.aurora;
  return 2 * extent * sigma * Math.max(width, height);
}

/** The orb's Gaussian falloff (peak alpha at the centre) as radial-gradient stops. */
export function orbGradient(color: string, tone: 'dark' | 'light'): string {
  const { extent, alpha } = motion.aurora;
  const peak = tone === 'light' ? alpha.light : alpha.dark;
  const [r, g, b] = hexToRgb(color);
  const stops = Array.from({ length: 9 }, (_, i) => {
    const f = i / 8;
    const a = peak * Math.exp(-((f * extent) ** 2) / 2);
    return `rgb(${r} ${g} ${b} / ${a.toFixed(4)}) ${(f * 100).toFixed(1)}%`;
  });
  return `radial-gradient(circle closest-side, ${stops.join(', ')})`;
}

// --- Scrim and spectrum -----------------------------------------------------------------

/** Readability gradient the export draws under the lyrics with aurora and spectrum. */
export function scrimGradient(tone: 'dark' | 'light'): string {
  const [top, mid, bottom] = tone === 'light' ? motion.scrim.light : motion.scrim.dark;
  const c = tone === 'light' ? '255 255 255' : '0 0 0';
  return `linear-gradient(to top, rgb(${c} / ${bottom}), rgb(${c} / ${mid}), rgb(${c} / ${top}))`;
}

export const SPECTRUM = motion.spectrum;

// --- Palette ------------------------------------------------------------------------------

/** Accents for presets that define none (Afterglow's duet colours). */
export const DEFAULT_BACKGROUND_ACCENTS: readonly [string, string] = ['#f472b6', '#5eead4'];

/**
 * Colours for aurora and spectrum: the sung colour, then the Singer 2 and Both colours the user
 * picked, else the preset's own accents. (The default duet colours clash with most presets.)
 */
export function stageBackgroundPalette(
  theme: VisualTheme,
  colors: { sung: string; singer2?: string | null; both?: string | null }
): [string, string, string] {
  const accents = theme.backgroundAccents ?? DEFAULT_BACKGROUND_ACCENTS;
  return [colors.sung, colors.singer2 || accents[0], colors.both || accents[1]];
}

export function hexToRgb(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1] ?? '000000';
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

// --- Lyric outline ----------------------------------------------------------------------

/**
 * The outline exports draw around lyrics (ASS Outline 3 at a 52 px font, dark ink; 2 px of
 * paper white on light presets; backend/services/ass_generator.py), as text shadows, so the
 * stage stays as readable as the video over bright cover art.
 */
export function lyricOutline(tone: 'dark' | 'light'): string {
  const [width, color] = tone === 'light' ? [0.038, '#ffffff'] : [0.058, '#111111'];
  const d = width * Math.SQRT1_2;
  const offsets: Array<[number, number]> = [
    [width, 0],
    [-width, 0],
    [0, width],
    [0, -width],
    [d, d],
    [-d, d],
    [d, -d],
    [-d, -d],
  ];
  return offsets.map(([x, y]) => `${x.toFixed(3)}em ${y.toFixed(3)}em 0 ${color}`).join(', ');
}
