/**
 * Visual Theme, Custom Palette & Typography Hook
 *
 * Encapsulates visual themes, custom sung/unsung colors, font size scaling,
 * aspect ratio switching, and the stage background (style, palette and upload).
 * Reactively synchronizes with application theme when mounted within AppThemeProvider,
 * while maintaining resilient fallback for isolated unit tests.
 */

import { useState, useCallback, useMemo, useEffect, useContext, useRef } from 'react';
import { VisualTheme, SyncDisplayMode } from '../types';
import {
  DEFAULT_BOTH_COLOR,
  DEFAULT_SINGER2_COLOR,
  THEMES,
  getStageBackground,
  getStagePreset,
} from '../theme/stagePresets';
import {
  DEFAULT_STAGE_SETTINGS,
  StageSettings,
  StageSize,
  loadStageSettings,
  saveStageSettings,
} from '../theme/stageSettingsStorage';
import { StageBackgroundStyle, stageBackgroundPalette } from '../theme/stageBackgrounds';
import { DEFAULT_APP_THEME_ID, getAppTheme } from '../theme/appThemes';
import { AppThemeContext } from '../context/AppThemeContext';

/**
 * Converts CSS hex color (#RRGGBB or RRGGBB) to ASS color format (&H00BBGGRR).
 */
export function cssToAssColor(cssColor: string, defaultAss = '&H0000D7FF'): string {
  if (!cssColor) return defaultAss;
  const c = cssColor.trim();
  if (c.startsWith('&H') || c.startsWith('&h')) {
    return c.toUpperCase();
  }
  let hex = c.startsWith('#') ? c.slice(1) : c;
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = hex.slice(0, 2).toUpperCase();
    const g = hex.slice(2, 4).toUpperCase();
    const b = hex.slice(4, 6).toUpperCase();
    return `&H00${b}${g}${r}`;
  }
  return defaultAss;
}

export interface StageBackgroundMedia {
  url: string;
  kind: 'image' | 'video';
}

/** Static URL and media kind for an uploaded stage background id. */
export function stageBackgroundFromId(
  bgId: string | null | undefined
): StageBackgroundMedia | null {
  if (!bgId) return null;
  return {
    url: `/static/backgrounds/${encodeURIComponent(bgId)}`,
    kind: /\.(mp4|webm|mov|m4v)$/i.test(bgId) ? 'video' : 'image',
  };
}

export interface UseVisualThemeReturn {
  selectedTheme: VisualTheme;
  setSelectedTheme: (theme: VisualTheme) => void;
  customSungColor: string | null;
  setCustomSungColor: (color: string | null) => void;
  customUnsungColor: string | null;
  setCustomUnsungColor: (color: string | null) => void;
  /** Singer 2 sung color override (duets). */
  customSinger2Color: string | null;
  setCustomSinger2Color: (color: string | null) => void;
  /** Sung color override for lines both singers share. */
  customBothColor: string | null;
  setCustomBothColor: (color: string | null) => void;
  fontSizeScale: number;
  setFontSizeScale: (scale: number) => void;
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
  customBgId: string;
  /** Sets the uploaded background ('' removes it); an upload becomes the background style. */
  setCustomBgId: (id: string) => void;
  /** What the stage and exports show behind the lyrics ('custom' is the uploaded file). */
  backgroundStyle: StageBackgroundStyle;
  setBackgroundStyle: (style: StageBackgroundStyle) => void;
  /** Aurora and spectrum colours: the sung colour and two accents. */
  backgroundPalette: [string, string, string];
  syncMode: SyncDisplayMode;
  setSyncMode: (mode: SyncDisplayMode) => void;
  showVisualizer: boolean;
  setShowVisualizer: (show: boolean) => void;
  toggleVisualizer: () => void;
  showChordBar: boolean;
  setShowChordBar: (show: boolean) => void;
  toggleChordBar: () => void;
  /** Desktop stage height budget in the studio layout. */
  stageSize: StageSize;
  setStageSize: (size: StageSize) => void;
  resetThemeDefaults: () => void;
  activeSungColor: string;
  activeUnsungColor: string;
  activeSinger2Color: string;
  activeBothColor: string;
  /** Solid stage backdrop behind artwork (also the video's fallback background). */
  stageBackgroundColor: string;
  /** Uploaded background shown behind the stage lyrics, when it is the chosen style. */
  stageBackground: StageBackgroundMedia | null;
  effectiveTheme: VisualTheme & { font_size_scale: number; sync_mode?: SyncDisplayMode };
}

export interface UseVisualThemeOptions {
  /** Restore and save the stage settings in localStorage (the studio passes true). */
  persist?: boolean;
}

export function useVisualTheme(
  initialTheme?: VisualTheme,
  options: UseVisualThemeOptions = {}
): UseVisualThemeReturn {
  const { persist = false } = options;
  const appThemeContext = useContext(AppThemeContext);
  const activePresetId = appThemeContext?.theme?.stagePresetId;

  // Saved settings are read once, when the studio mounts
  const [stored] = useState<StageSettings | null>(() => (persist ? loadStageSettings() : null));
  const restoredPreset =
    !initialTheme && stored?.presetSource === 'user' ? getStagePreset(stored.presetId) : undefined;

  const [selectedTheme, setSelectedThemeState] = useState<VisualTheme>(() => {
    if (initialTheme) return initialTheme;
    if (restoredPreset) return restoredPreset;
    if (appThemeContext && activePresetId) {
      const match = THEMES.find((t) => t.id === activePresetId);
      if (match) return match;
    }
    if (appThemeContext) {
      const fallbackPresetId = getAppTheme(DEFAULT_APP_THEME_ID).stagePresetId;
      const fallback = THEMES.find((t) => t.id === fallbackPresetId);
      if (fallback) return fallback;
    }
    return THEMES[0];
  });
  const [presetSource, setPresetSource] = useState<'user' | 'app'>(restoredPreset ? 'user' : 'app');

  const seed = stored ?? DEFAULT_STAGE_SETTINGS;
  const [customSungColor, setCustomSungColor] = useState<string | null>(seed.customSungColor);
  const [customUnsungColor, setCustomUnsungColor] = useState<string | null>(seed.customUnsungColor);
  const [customSinger2Color, setCustomSinger2Color] = useState<string | null>(seed.singer2Color);
  const [customBothColor, setCustomBothColor] = useState<string | null>(seed.bothColor);
  const [fontSizeScale, setFontSizeScale] = useState<number>(seed.fontSizeScale);
  const [aspectRatio, setAspectRatio] = useState<string>(seed.aspectRatio);
  const [customBgId, setCustomBgIdState] = useState<string>(seed.customBgId);
  const [backgroundStyle, setBackgroundStyle] = useState<StageBackgroundStyle>(
    seed.backgroundStyle
  );
  const [syncMode, setSyncMode] = useState<SyncDisplayMode>(seed.syncMode);
  const [showVisualizer, setShowVisualizer] = useState<boolean>(seed.showVisualizer);
  const [showChordBar, setShowChordBar] = useState<boolean>(seed.showChordBar);
  const [stageSize, setStageSize] = useState<StageSize>(seed.stageSize);

  const setSelectedTheme = useCallback((theme: VisualTheme) => {
    setSelectedThemeState(theme);
    setPresetSource('user');
  }, []);
  const setCustomBgId = useCallback((id: string) => {
    setCustomBgIdState(id);
    setBackgroundStyle((prev) => (id ? 'custom' : prev === 'custom' ? 'artwork' : prev));
  }, []);
  const toggleVisualizer = useCallback(() => setShowVisualizer((prev) => !prev), []);
  const toggleChordBar = useCallback(() => setShowChordBar((prev) => !prev), []);

  const prevPresetIdRef = useRef<string | undefined>(activePresetId);

  // Reactively synchronize stage preset when application theme changes
  // STRICTLY PRESERVES customSungColor and customUnsungColor
  useEffect(() => {
    if (!appThemeContext || !activePresetId) return;
    if (activePresetId !== prevPresetIdRef.current) {
      prevPresetIdRef.current = activePresetId;
      const match = THEMES.find((t) => t.id === activePresetId);
      if (match && match.id !== selectedTheme.id) {
        setSelectedThemeState(match);
      }
      setPresetSource('app');
    }
  }, [appThemeContext, activePresetId, selectedTheme.id]);

  useEffect(() => {
    if (!persist) return;
    saveStageSettings({
      presetId: selectedTheme.id,
      presetSource,
      customSungColor,
      customUnsungColor,
      singer2Color: customSinger2Color,
      bothColor: customBothColor,
      fontSizeScale,
      aspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
      syncMode,
      backgroundStyle,
      customBgId,
      showVisualizer,
      showChordBar,
      stageSize,
    });
  }, [
    persist,
    selectedTheme.id,
    presetSource,
    customSungColor,
    customUnsungColor,
    customSinger2Color,
    customBothColor,
    fontSizeScale,
    aspectRatio,
    syncMode,
    backgroundStyle,
    customBgId,
    showVisualizer,
    showChordBar,
    stageSize,
  ]);

  const stageBackground = useMemo(
    () => (backgroundStyle === 'custom' ? stageBackgroundFromId(customBgId) : null),
    [backgroundStyle, customBgId]
  );

  const activeSungColor = customSungColor ?? selectedTheme.previewSung;
  const activeUnsungColor = customUnsungColor ?? selectedTheme.previewUnsung;
  const activeSinger2Color =
    customSinger2Color ?? selectedTheme.singer2Color ?? DEFAULT_SINGER2_COLOR;
  const activeBothColor = customBothColor ?? selectedTheme.bothColor ?? DEFAULT_BOTH_COLOR;
  const stageBackgroundColor = getStageBackground(selectedTheme);
  const backgroundPalette = useMemo(
    () =>
      stageBackgroundPalette(selectedTheme, {
        sung: activeSungColor,
        singer2: customSinger2Color,
        both: customBothColor,
      }),
    [selectedTheme, activeSungColor, customSinger2Color, customBothColor]
  );

  const resetThemeDefaults = useCallback(() => {
    setCustomSungColor(null);
    setCustomUnsungColor(null);
    setCustomSinger2Color(null);
    setCustomBothColor(null);
    setFontSizeScale(1.0);
    setSyncMode('word');
  }, []);

  const effectiveTheme = useMemo(
    () => ({
      ...selectedTheme,
      primary_color: customSungColor
        ? cssToAssColor(activeSungColor, selectedTheme.primary_color)
        : selectedTheme.primary_color,
      secondary_color: customUnsungColor
        ? cssToAssColor(activeUnsungColor, selectedTheme.secondary_color)
        : selectedTheme.secondary_color,
      previewSung: activeSungColor,
      previewUnsung: activeUnsungColor,
      font_size_scale: fontSizeScale,
      sync_mode: syncMode,
    }),
    [
      selectedTheme,
      customSungColor,
      customUnsungColor,
      activeSungColor,
      activeUnsungColor,
      fontSizeScale,
      syncMode,
    ]
  );

  // Sync active CSS variables to root element for responsive typography & theme sweeps
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--karaoke-font-scale', String(fontSizeScale));
      document.documentElement.style.setProperty('--karaoke-sung-color', activeSungColor);
      document.documentElement.style.setProperty('--karaoke-unsung-color', activeUnsungColor);
      if (selectedTheme.fontFamily) {
        document.documentElement.style.setProperty(
          '--karaoke-font-family',
          selectedTheme.fontFamily
        );
      }
      document.documentElement.setAttribute('data-sync-mode', syncMode);
      document.documentElement.setAttribute('data-stage-preset', selectedTheme.id);
    }
  }, [fontSizeScale, activeSungColor, activeUnsungColor, selectedTheme, syncMode]);

  return {
    selectedTheme,
    setSelectedTheme,
    customSungColor,
    setCustomSungColor,
    customUnsungColor,
    setCustomUnsungColor,
    customSinger2Color,
    setCustomSinger2Color,
    customBothColor,
    setCustomBothColor,
    fontSizeScale,
    setFontSizeScale,
    aspectRatio,
    setAspectRatio,
    customBgId,
    setCustomBgId,
    backgroundStyle,
    setBackgroundStyle,
    backgroundPalette,
    syncMode,
    setSyncMode,
    showVisualizer,
    setShowVisualizer,
    toggleVisualizer,
    showChordBar,
    setShowChordBar,
    toggleChordBar,
    stageSize,
    setStageSize,
    resetThemeDefaults,
    activeSungColor,
    activeUnsungColor,
    activeSinger2Color,
    activeBothColor,
    stageBackgroundColor,
    stageBackground,
    effectiveTheme,
  };
}
