/**
 * Stage look, colours and typography hook
 *
 * Holds the stage look, the colours chosen for it, the lyric size, the format and the stage
 * background (style, palette and upload). A stage starts on the default look, or on the one it
 * showed last when settings are kept. Colour choices belong to the look they were made on.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { SyncDisplayMode } from '../types';
import {
  DEFAULT_STAGE_LOOK_ID,
  getStageLook,
  type LookId,
  type StageLook,
} from '../theme/stageLooks';
import {
  DEFAULT_STAGE_SETTINGS,
  NO_LOOK_COLORS,
  LookColors,
  StageSettings,
  StageSize,
  loadStageSettings,
  saveStageSettings,
} from '../theme/stageSettingsStorage';
import { StageBackgroundStyle } from '../theme/stageBackgrounds';

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
  /** The look the stage and exports are drawn in. */
  selectedTheme: StageLook;
  setSelectedTheme: (look: StageLook) => void;
  /** The colours chosen for the current look (null: the look's own). */
  customSungColor: string | null;
  setCustomSungColor: (color: string | null) => void;
  customUnsungColor: string | null;
  setCustomUnsungColor: (color: string | null) => void;
  /** Singer 2 colour override (duets). */
  customSinger2Color: string | null;
  setCustomSinger2Color: (color: string | null) => void;
  /** Colour override for lines both singers share. */
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
  /** Aurora and spectrum colours: the sung, Singer 2 and Both colours in use. */
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
  /** Back to the current look's own colours, the normal lyric size and word highlighting. */
  resetThemeDefaults: () => void;
  activeSungColor: string;
  activeUnsungColor: string;
  activeSinger2Color: string;
  activeBothColor: string;
  /** The look's ground colour, behind everything. */
  stageBackgroundColor: string;
  /** Uploaded background shown behind the stage lyrics, when it is the chosen style. */
  stageBackground: StageBackgroundMedia | null;
}

export interface UseVisualThemeOptions {
  /** Restore and save the stage settings in localStorage (the studio passes true). */
  persist?: boolean;
}

export function useVisualTheme(
  initialLook?: StageLook,
  options: UseVisualThemeOptions = {}
): UseVisualThemeReturn {
  const { persist = false } = options;

  // Saved settings are read once, when the studio mounts
  const [stored] = useState<StageSettings | null>(() => (persist ? loadStageSettings() : null));
  const seed = stored ?? DEFAULT_STAGE_SETTINGS;

  const [selectedTheme, setSelectedTheme] = useState<StageLook>(
    () => initialLook ?? getStageLook(stored?.lookId ?? DEFAULT_STAGE_LOOK_ID)
  );
  const [colors, setColors] = useState<StageSettings['colors']>(seed.colors);
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

  const lookId: LookId = selectedTheme.id;
  const chosen = colors[lookId] ?? NO_LOOK_COLORS;

  /** Sets one of the current look's colours. */
  const setColor = useCallback(
    (key: keyof LookColors, value: string | null) =>
      setColors((all) => ({
        ...all,
        [lookId]: { ...(all[lookId] ?? NO_LOOK_COLORS), [key]: value },
      })),
    [lookId]
  );
  const setCustomSungColor = useCallback((c: string | null) => setColor('sung', c), [setColor]);
  const setCustomUnsungColor = useCallback((c: string | null) => setColor('unsung', c), [setColor]);
  const setCustomSinger2Color = useCallback(
    (c: string | null) => setColor('singer2', c),
    [setColor]
  );
  const setCustomBothColor = useCallback((c: string | null) => setColor('both', c), [setColor]);

  const setCustomBgId = useCallback((id: string) => {
    setCustomBgIdState(id);
    setBackgroundStyle((prev) => (id ? 'custom' : prev === 'custom' ? 'artwork' : prev));
  }, []);
  const toggleVisualizer = useCallback(() => setShowVisualizer((prev) => !prev), []);
  const toggleChordBar = useCallback(() => setShowChordBar((prev) => !prev), []);

  useEffect(() => {
    if (!persist) return;
    saveStageSettings({
      lookId,
      colors,
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
    lookId,
    colors,
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

  const { palette } = selectedTheme;
  const activeSungColor = chosen.sung ?? palette.sung;
  const activeUnsungColor = chosen.unsung ?? palette.unsung;
  const activeSinger2Color = chosen.singer2 ?? palette.singer2;
  const activeBothColor = chosen.both ?? palette.both;
  // Aurora and spectrum glow in the colour that marks the look's words (the words to sing,
  // in a look that dims what was sung), then the two duet colours
  const leadColor = selectedTheme.emphasis === 'unsung' ? activeUnsungColor : activeSungColor;
  const backgroundPalette = useMemo<[string, string, string]>(
    () => [leadColor, activeSinger2Color, activeBothColor],
    [leadColor, activeSinger2Color, activeBothColor]
  );

  const resetThemeDefaults = useCallback(() => {
    setColors((all) => {
      const rest = { ...all };
      delete rest[lookId];
      return rest;
    });
    setFontSizeScale(1.0);
    setSyncMode('word');
  }, [lookId]);

  // The look and highlight mode on the root element, for styles and tests that follow them
  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-sync-mode', syncMode);
      document.documentElement.setAttribute('data-stage-look', lookId);
    }
  }, [lookId, syncMode]);

  // Memoised so components receiving `theme` re-render only when it changes
  return useMemo(
    () => ({
      selectedTheme,
      setSelectedTheme,
      customSungColor: chosen.sung,
      setCustomSungColor,
      customUnsungColor: chosen.unsung,
      setCustomUnsungColor,
      customSinger2Color: chosen.singer2,
      setCustomSinger2Color,
      customBothColor: chosen.both,
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
      stageBackgroundColor: palette.ground,
      stageBackground,
    }),
    [
      selectedTheme,
      chosen.sung,
      chosen.unsung,
      chosen.singer2,
      chosen.both,
      setCustomSungColor,
      setCustomUnsungColor,
      setCustomSinger2Color,
      setCustomBothColor,
      fontSizeScale,
      aspectRatio,
      customBgId,
      setCustomBgId,
      backgroundStyle,
      backgroundPalette,
      syncMode,
      showVisualizer,
      toggleVisualizer,
      showChordBar,
      toggleChordBar,
      stageSize,
      resetThemeDefaults,
      activeSungColor,
      activeUnsungColor,
      activeSinger2Color,
      activeBothColor,
      palette.ground,
      stageBackground,
    ]
  );
}
