/**
 * Visual Theme, Custom Palette & Typography Hook
 *
 * Encapsulates visual themes, custom sung/unsung colors, font size scaling,
 * aspect ratio switching, and custom background state.
 * Reactively synchronizes with application theme when mounted within AppThemeProvider,
 * while maintaining resilient fallback for isolated unit tests.
 */

import { useState, useCallback, useMemo, useEffect, useContext, useRef } from 'react';
import { VisualTheme, SyncDisplayMode } from '../types';
import { THEMES } from '../theme/stagePresets';
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

export interface UseVisualThemeReturn {
  selectedTheme: VisualTheme;
  setSelectedTheme: (theme: VisualTheme) => void;
  customSungColor: string | null;
  setCustomSungColor: (color: string | null) => void;
  customUnsungColor: string | null;
  setCustomUnsungColor: (color: string | null) => void;
  fontSizeScale: number;
  setFontSizeScale: (scale: number) => void;
  aspectRatio: string;
  setAspectRatio: (ratio: string) => void;
  customBgId: string;
  setCustomBgId: (id: string) => void;
  syncMode: SyncDisplayMode;
  setSyncMode: (mode: SyncDisplayMode) => void;
  resetThemeDefaults: () => void;
  activeSungColor: string;
  activeUnsungColor: string;
  effectiveTheme: VisualTheme & { font_size_scale: number; sync_mode?: SyncDisplayMode };
}

export function useVisualTheme(initialTheme?: VisualTheme): UseVisualThemeReturn {
  const appThemeContext = useContext(AppThemeContext);
  const activePresetId = appThemeContext?.theme?.stagePresetId;

  const [selectedTheme, setSelectedTheme] = useState<VisualTheme>(() => {
    if (initialTheme) return initialTheme;
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

  const [customSungColor, setCustomSungColor] = useState<string | null>(null);
  const [customUnsungColor, setCustomUnsungColor] = useState<string | null>(null);
  const [fontSizeScale, setFontSizeScale] = useState<number>(1.0);
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [customBgId, setCustomBgId] = useState<string>('');
  const [syncMode, setSyncMode] = useState<SyncDisplayMode>('word');

  const prevPresetIdRef = useRef<string | undefined>(activePresetId);

  // Reactively synchronize stage preset when application theme changes
  // STRICTLY PRESERVES customSungColor and customUnsungColor
  useEffect(() => {
    if (!appThemeContext || !activePresetId) return;
    if (activePresetId !== prevPresetIdRef.current) {
      prevPresetIdRef.current = activePresetId;
      const match = THEMES.find((t) => t.id === activePresetId);
      if (match && match.id !== selectedTheme.id) {
        setSelectedTheme(match);
      }
    }
  }, [appThemeContext, activePresetId, selectedTheme.id]);

  const activeSungColor = customSungColor ?? selectedTheme.previewSung;
  const activeUnsungColor = customUnsungColor ?? selectedTheme.previewUnsung;

  const resetThemeDefaults = useCallback(() => {
    setCustomSungColor(null);
    setCustomUnsungColor(null);
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
    fontSizeScale,
    setFontSizeScale,
    aspectRatio,
    setAspectRatio,
    customBgId,
    setCustomBgId,
    syncMode,
    setSyncMode,
    resetThemeDefaults,
    activeSungColor,
    activeUnsungColor,
    effectiveTheme,
  };
}
