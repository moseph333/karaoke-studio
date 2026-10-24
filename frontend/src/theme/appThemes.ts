/**
 * Application Theme Token Definitions
 *
 * Defines the 4 distinct human-crafted application themes across 4 visual dimensions:
 * 1. Colors (Backgrounds, Surfaces, Borders, Text, Accents, Sung/Unsung)
 * 2. Typography (Heading, Body, Monospace, Karaoke Stage)
 * 3. Geometry (Radii: sm, md, lg, xl, pill; Border Widths: standard, thick)
 * 4. Shadows & Textures (sm, md, lg, glow, card)
 *
 * Default signature theme: Punk Rock / Underground / DIY (punk_diy).
 */

import {
  AppTheme,
  AppThemeId,
  AppThemeColors,
  AppThemeTypography,
  AppThemeGeometry,
  AppThemeShadows,
} from '../types';

export const APP_THEME_STORAGE_KEY = 'karaoke_app_theme';
export const DEFAULT_APP_THEME_ID: AppThemeId = 'punk_diy';
export const DEFAULT_THEME_ID: AppThemeId = DEFAULT_APP_THEME_ID;

/**
 * Builds the atomic CSS custom property key-value map for an AppTheme.
 */
export function buildThemeCssVariables(
  colors: AppThemeColors,
  typography: AppThemeTypography,
  geometry: AppThemeGeometry,
  shadows: AppThemeShadows
): Record<string, string> {
  return {
    // Theme semantic tokens (--theme-*)
    '--theme-bg': colors.bg,
    '--theme-surface': colors.surface,
    '--theme-surface-subtle': colors.surfaceSubtle,
    '--theme-surface-raised': colors.surfaceRaised,
    '--theme-border': colors.border,
    '--theme-border-subtle': colors.borderSubtle,
    '--theme-text': colors.text,
    '--theme-text-muted': colors.textMuted,
    '--theme-text-inverse': colors.textInverse,
    '--theme-accent': colors.accent,
    '--theme-accent-hover': colors.accentHover,
    '--theme-accent-text': colors.accentText,
    '--theme-secondary': colors.secondary,
    '--theme-highlight': colors.highlight,
    '--theme-sung': colors.sung,
    '--theme-unsung': colors.unsung,

    '--theme-font-heading': typography.heading,
    '--theme-font-body': typography.body,
    '--theme-font-mono': typography.mono,
    '--theme-font-karaoke': typography.karaoke,
    '--karaoke-font-family': typography.karaoke,

    '--theme-radius-sm': geometry.radiusSm,
    '--theme-radius-md': geometry.radiusMd,
    '--theme-radius-lg': geometry.radiusLg,
    '--theme-radius-xl': geometry.radiusXl,
    '--theme-radius-pill': geometry.radiusPill,
    '--theme-border-width': geometry.borderWidth,
    '--theme-border-width-thick': geometry.borderWidthThick,

    '--theme-shadow-sm': shadows.sm,
    '--theme-shadow-md': shadows.md,
    '--theme-shadow-lg': shadows.lg,
    '--theme-shadow-glow': shadows.glow,

    // Backward-compatible and test alias tokens (--app-*)
    '--app-bg': colors.bg,
    '--app-surface': colors.surface,
    '--app-border-color': colors.border,
    '--app-text': colors.text,
    '--app-text-muted': colors.textMuted,
    '--app-accent': colors.accent,
    '--app-font-heading': typography.heading,
    '--app-font-body': typography.body,
    '--app-font-mono': typography.mono,
    '--app-radius': geometry.radiusMd,
    '--app-border-width': geometry.borderWidth,
    '--app-shadow-card': shadows.card || shadows.md,
  };
}

/**
 * Synchronizes the active theme to document.documentElement:
 * Sets data-theme attribute and all CSS custom properties.
 */
export function applyThemeToDom(theme: AppTheme): void {
  if (
    typeof document === 'undefined' ||
    !document.documentElement ||
    !theme ||
    !theme.cssVariables
  ) {
    return;
  }

  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id || DEFAULT_APP_THEME_ID);

  for (const [key, value] of Object.entries(theme.cssVariables)) {
    root.style.setProperty(key, value);
  }
}

/* ==========================================================================
   THEME 1: PUNK ROCK / UNDERGROUND / DIY (Signature Default)
   Vibe: Raw cut-and-paste zine, Xerox photocopy toner, typewriter monospace,
         sharp cut edges, hard offset drop shadows, flyer yellow & safety red.
   ========================================================================== */
const PUNK_COLORS: AppThemeColors = {
  bg: '#0d0d0f',
  surface: '#17171a',
  surfaceSubtle: '#202024',
  surfaceRaised: '#28282d',
  border: '#facc15',
  borderSubtle: '#3f3f46',
  text: '#f5f5f5',
  textMuted: '#a1a1aa',
  textInverse: '#000000',
  accent: '#facc15',
  accentHover: '#fde047',
  accentText: '#000000',
  secondary: '#ef4444',
  highlight: '#ec4899',
  sung: '#facc15',
  unsung: '#f5f5f5',
};

const PUNK_TYPOGRAPHY: AppThemeTypography = {
  heading: 'Impact, "Arial Black", "Trebuchet MS", sans-serif',
  body: '"Courier Prime", "Courier New", Courier, monospace',
  mono: '"Courier Prime", "Courier New", Courier, monospace',
  karaoke: 'Impact, "Arial Black", sans-serif',
};

const PUNK_GEOMETRY: AppThemeGeometry = {
  radiusSm: '0px',
  radiusMd: '0px',
  radiusLg: '0px',
  radiusXl: '0px',
  radiusPill: '0px', // Non-pill, sharp cut edges
  borderWidth: '2px',
  borderWidthThick: '3px',
};

const PUNK_SHADOWS: AppThemeShadows = {
  sm: '2px 2px 0px #000000',
  md: '4px 4px 0px #000000',
  lg: '5px 5px 0px #facc15',
  glow: '4px 4px 0px #ef4444',
  card: '4px 4px 0px #000000',
};

export const PUNK_DIY_THEME: AppTheme = {
  id: 'punk_diy',
  name: 'Basement Flyer',
  tagline: 'Raw zine Xerox stencil, flyer yellow & hard offset shadows',
  stagePresetId: 'punk_diy',
  swatches: {
    primary: '#facc15',
    accent: '#ef4444',
    bg: '#0d0d0f',
  },
  colors: PUNK_COLORS,
  typography: PUNK_TYPOGRAPHY,
  fonts: PUNK_TYPOGRAPHY,
  geometry: PUNK_GEOMETRY,
  borders: {
    radius: '0px',
    width: '2px',
    style: 'solid',
  },
  shadows: PUNK_SHADOWS,
  cssVariables: buildThemeCssVariables(PUNK_COLORS, PUNK_TYPOGRAPHY, PUNK_GEOMETRY, PUNK_SHADOWS),
};

/* ==========================================================================
   THEME 2: ANALOG 70s TAPE STUDIO
   Vibe: Teak wood console, reel-to-reel tape deck, warm amber VU meter glow,
         curved Bakelite chassis, vintage display serif typography.
   ========================================================================== */
const TAPE_COLORS: AppThemeColors = {
  bg: '#1a1410',
  surface: '#271e18',
  surfaceSubtle: '#362a22',
  surfaceRaised: '#44352b',
  border: '#d97706',
  borderSubtle: '#574334',
  text: '#fef3c7',
  textMuted: '#b59f84',
  textInverse: '#1a1410',
  accent: '#f59e0b',
  accentHover: '#fbbf24',
  accentText: '#1a1410',
  secondary: '#b45309',
  highlight: '#d97706',
  sung: '#f59e0b',
  unsung: '#fef3c7',
};

const TAPE_TYPOGRAPHY: AppThemeTypography = {
  heading: 'Fraunces, "Cooper Black", Georgia, "Times New Roman", serif',
  body: '"Space Grotesk", "DM Sans", system-ui, sans-serif',
  mono: '"Courier Prime", "Courier New", monospace',
  karaoke: 'Fraunces, "Cooper Black", Georgia, serif',
};

const TAPE_GEOMETRY: AppThemeGeometry = {
  radiusSm: '6px',
  radiusMd: '10px',
  radiusLg: '16px',
  radiusXl: '22px',
  radiusPill: '9999px',
  borderWidth: '1.5px',
  borderWidthThick: '2.5px',
};

const TAPE_SHADOWS: AppThemeShadows = {
  sm: '0 2px 4px rgba(26, 20, 16, 0.4)',
  md: '0 4px 12px rgba(26, 20, 16, 0.6), 0 0 4px rgba(217, 119, 6, 0.15)',
  lg: '0 10px 24px rgba(26, 20, 16, 0.8), 0 0 16px rgba(245, 158, 11, 0.2)',
  glow: '0 0 20px rgba(245, 158, 11, 0.35)',
  card: '0 4px 12px rgba(26, 20, 16, 0.6)',
};

export const TAPE_STUDIO_70S_THEME: AppTheme = {
  id: 'tape_studio_70s',
  name: "Reel-to-Reel '74",
  tagline: 'Warm walnut chassis, incandescent amber VU & display serif',
  stagePresetId: 'tape_70s',
  swatches: {
    primary: '#f59e0b',
    accent: '#d97706',
    bg: '#1a1410',
  },
  colors: TAPE_COLORS,
  typography: TAPE_TYPOGRAPHY,
  fonts: TAPE_TYPOGRAPHY,
  geometry: TAPE_GEOMETRY,
  borders: {
    radius: '10px',
    width: '1.5px',
    style: 'solid',
  },
  shadows: TAPE_SHADOWS,
  cssVariables: buildThemeCssVariables(TAPE_COLORS, TAPE_TYPOGRAPHY, TAPE_GEOMETRY, TAPE_SHADOWS),
};

/* ==========================================================================
   THEME 3: DIVE BAR CRT KTV
   Vibe: Grimy karaoke private booth, cathode-ray tube television, glowing
         neon cyan/magenta tube signs, arcade scanline phosphor display.
   ========================================================================== */
const CRT_COLORS: AppThemeColors = {
  bg: '#09080f',
  surface: '#13101f',
  surfaceSubtle: '#1c182e',
  surfaceRaised: '#26203d',
  border: '#06b6d4',
  borderSubtle: '#3a2b5e',
  text: '#e0e7ff',
  textMuted: '#8c7aa8',
  textInverse: '#09080f',
  accent: '#06b6d4',
  accentHover: '#22d3ee',
  accentText: '#09080f',
  secondary: '#f43f5e',
  highlight: '#d946ef',
  sung: '#06b6d4',
  unsung: '#e0e7ff',
};

const CRT_TYPOGRAPHY: AppThemeTypography = {
  heading: 'VT323, "Press Start 2P", "Courier New", monospace',
  body: '"Share Tech Mono", "Courier New", monospace',
  mono: 'VT323, "Courier New", monospace',
  karaoke: 'VT323, monospace',
};

const CRT_GEOMETRY: AppThemeGeometry = {
  radiusSm: '4px',
  radiusMd: '8px',
  radiusLg: '14px',
  radiusXl: '18px',
  radiusPill: '9999px',
  borderWidth: '1.5px',
  borderWidthThick: '2px',
};

const CRT_SHADOWS: AppThemeShadows = {
  sm: '0 0 6px rgba(6, 182, 212, 0.3)',
  md: '0 0 14px rgba(6, 182, 212, 0.4), 0 0 2px rgba(217, 70, 239, 0.3)',
  lg: '0 0 24px rgba(6, 182, 212, 0.5), 0 0 8px rgba(217, 70, 239, 0.4)',
  glow: '0 0 24px #06b6d4',
  card: '0 0 14px rgba(6, 182, 212, 0.4)',
};

export const DIVE_BAR_CRT_THEME: AppTheme = {
  id: 'dive_bar_crt',
  name: 'Midnight KTV Booth',
  tagline: 'Grimy neon cyan wipe & arcade pixel scanline CRT monitor',
  stagePresetId: 'crt_ktv',
  swatches: {
    primary: '#06b6d4',
    accent: '#d946ef',
    bg: '#09080f',
  },
  colors: CRT_COLORS,
  typography: CRT_TYPOGRAPHY,
  fonts: CRT_TYPOGRAPHY,
  geometry: CRT_GEOMETRY,
  borders: {
    radius: '8px',
    width: '1.5px',
    style: 'solid',
  },
  shadows: CRT_SHADOWS,
  cssVariables: buildThemeCssVariables(CRT_COLORS, CRT_TYPOGRAPHY, CRT_GEOMETRY, CRT_SHADOWS),
};

/* ==========================================================================
   THEME 4: BRUTALIST / CLEAN PAPER STUDIO
   Vibe: Swiss International style, unbleached drafting newsprint, razor-sharp
         ink lines, zero gradients, ultra-minimal architectural layout.
   ========================================================================== */
const PAPER_COLORS: AppThemeColors = {
  bg: '#f4f4f0',
  surface: '#ffffff',
  surfaceSubtle: '#eaeae4',
  surfaceRaised: '#ffffff',
  border: '#111111',
  borderSubtle: '#737373',
  text: '#111111',
  textMuted: '#525252',
  textInverse: '#ffffff',
  accent: '#111111',
  accentHover: '#000000',
  accentText: '#ffffff',
  secondary: '#dc2626',
  highlight: '#2563eb',
  sung: '#111111',
  unsung: '#525252',
};

const PAPER_TYPOGRAPHY: AppThemeTypography = {
  heading: '"Space Grotesk", "Helvetica Neue", Arial, sans-serif',
  body: 'Inter, system-ui, -apple-system, sans-serif',
  mono: '"JetBrains Mono", "Courier New", monospace',
  karaoke: '"Space Grotesk", "Helvetica Neue", sans-serif',
};

const PAPER_GEOMETRY: AppThemeGeometry = {
  radiusSm: '0px',
  radiusMd: '0px',
  radiusLg: '0px',
  radiusXl: '0px',
  radiusPill: '0px', // Razor-sharp 0px brutalist edges
  borderWidth: '1.5px',
  borderWidthThick: '3px',
};

const PAPER_SHADOWS: AppThemeShadows = {
  sm: '2px 2px 0px #111111',
  md: '4px 4px 0px #111111',
  lg: '6px 6px 0px #111111',
  glow: '4px 4px 0px #dc2626',
  card: '4px 4px 0px #111111',
};

export const CLEAN_PAPER_THEME: AppTheme = {
  id: 'clean_paper',
  name: 'Monolith Press',
  tagline: 'High-contrast monochrome newsprint & sharp Swiss geometry',
  stagePresetId: 'clean_paper',
  swatches: {
    primary: '#111111',
    accent: '#dc2626',
    bg: '#f4f4f0',
  },
  colors: PAPER_COLORS,
  typography: PAPER_TYPOGRAPHY,
  fonts: PAPER_TYPOGRAPHY,
  geometry: PAPER_GEOMETRY,
  borders: {
    radius: '0px',
    width: '1.5px',
    style: 'solid',
  },
  shadows: PAPER_SHADOWS,
  cssVariables: buildThemeCssVariables(
    PAPER_COLORS,
    PAPER_TYPOGRAPHY,
    PAPER_GEOMETRY,
    PAPER_SHADOWS
  ),
};

/* ==========================================================================
   THEME REGISTRY & HELPERS
   ========================================================================== */
export const APP_THEMES: Record<AppThemeId, AppTheme> & {
  [Symbol.iterator]: () => Iterator<AppTheme>;
} = {
  punk_diy: PUNK_DIY_THEME,
  tape_studio_70s: TAPE_STUDIO_70S_THEME,
  dive_bar_crt: DIVE_BAR_CRT_THEME,
  clean_paper: CLEAN_PAPER_THEME,
  [Symbol.iterator]: function* () {
    yield PUNK_DIY_THEME;
    yield TAPE_STUDIO_70S_THEME;
    yield DIVE_BAR_CRT_THEME;
    yield CLEAN_PAPER_THEME;
  },
};

export const APP_THEME_LIST: AppTheme[] = [
  PUNK_DIY_THEME,
  TAPE_STUDIO_70S_THEME,
  DIVE_BAR_CRT_THEME,
  CLEAN_PAPER_THEME,
];

export const APP_THEME_MAP = APP_THEMES;

const VALID_THEME_IDS = new Set<string>([
  'punk_diy',
  'tape_studio_70s',
  'dive_bar_crt',
  'clean_paper',
]);

/**
 * Type guard to verify whether a string is a valid AppThemeId.
 */
export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && VALID_THEME_IDS.has(value);
}

/**
 * Retrieves the AppTheme configuration by ID, safely falling back to DEFAULT_APP_THEME_ID.
 */
export function getAppTheme(id: AppThemeId | string | undefined | null): AppTheme {
  if (id && isAppThemeId(id) && APP_THEMES[id]) {
    return APP_THEMES[id];
  }
  return APP_THEMES[DEFAULT_APP_THEME_ID];
}

/**
 * Defensively reads the stored theme ID from localStorage.
 * Falls back to DEFAULT_APP_THEME_ID ('punk_diy') on missing, corrupt, or restricted values.
 */
export function getStoredAppTheme(): AppThemeId {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return DEFAULT_APP_THEME_ID;
    }
    const raw = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (raw && isAppThemeId(raw)) {
      return raw;
    }
  } catch {
    // Restricted or headless environment
  }
  return DEFAULT_APP_THEME_ID;
}

/**
 * Defensively writes the selected theme ID to localStorage.
 */
export function setStoredAppTheme(themeId: AppThemeId): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, themeId);
    }
  } catch {
    // Restricted environment or storage quota exceeded
  }
}
