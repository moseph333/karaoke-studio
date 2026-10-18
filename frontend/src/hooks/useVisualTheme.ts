/**
 * Visual Theme, Custom Palette & Typography Hook
 *
 * Encapsulates visual themes, custom sung/unsung colors, font size scaling,
 * aspect ratio switching, and custom background state.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { VisualTheme } from '../types';
import { THEMES } from '../components/VisualThemePicker';

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
  resetThemeDefaults: () => void;
  activeSungColor: string;
  activeUnsungColor: string;
  effectiveTheme: VisualTheme & { font_size_scale: number };
}

export function useVisualTheme(initialTheme: VisualTheme = THEMES[0]): UseVisualThemeReturn {
  const [selectedTheme, setSelectedTheme] = useState<VisualTheme>(initialTheme);
  const [customSungColor, setCustomSungColor] = useState<string | null>(null);
  const [customUnsungColor, setCustomUnsungColor] = useState<string | null>(null);
  const [fontSizeScale, setFontSizeScale] = useState<number>(1.0);
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [customBgId, setCustomBgId] = useState<string>('');

  const activeSungColor = customSungColor || selectedTheme.previewSung;
  const activeUnsungColor = customUnsungColor || selectedTheme.previewUnsung;

  const resetThemeDefaults = useCallback(() => {
    setCustomSungColor(null);
    setCustomUnsungColor(null);
    setFontSizeScale(1.0);
  }, []);

  const effectiveTheme = useMemo(
    () => ({
      ...selectedTheme,
      primary_color: customSungColor
        ? cssToAssColor(customSungColor, selectedTheme.primary_color)
        : selectedTheme.primary_color,
      secondary_color: customUnsungColor
        ? cssToAssColor(customUnsungColor, selectedTheme.secondary_color)
        : selectedTheme.secondary_color,
      previewSung: activeSungColor,
      previewUnsung: activeUnsungColor,
      font_size_scale: fontSizeScale,
    }),
    [
      selectedTheme,
      customSungColor,
      customUnsungColor,
      activeSungColor,
      activeUnsungColor,
      fontSizeScale,
    ]
  );

  // Sync active CSS variables to root element for responsive typography & theme sweeps
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.setProperty('--karaoke-font-scale', String(fontSizeScale));
      document.documentElement.style.setProperty('--karaoke-sung-color', activeSungColor);
      document.documentElement.style.setProperty('--karaoke-unsung-color', activeUnsungColor);
    }
  }, [fontSizeScale, activeSungColor, activeUnsungColor]);

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
    resetThemeDefaults,
    activeSungColor,
    activeUnsungColor,
    effectiveTheme,
  };
}
