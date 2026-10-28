/**
 * Studio commands for the command palette: playback, stage, mix, themes, song actions and
 * navigation, plus a song search source across the library.
 */

import React, { useCallback, useRef } from 'react';
import {
  Gauge,
  HelpCircle,
  Layers,
  LayoutPanelTop,
  ListMusic,
  Maximize2,
  Mic,
  Minus,
  Monitor,
  Music,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo,
  RotateCcw,
  SkipBack,
  SkipForward,
  Smartphone,
  Sparkles,
  Trash2,
  Undo,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ProjectState, StudioWorkspaceTab } from '../types';
import { apiFetch } from '../api';
import {
  PaletteCommand,
  useRegisterCommandSource,
  useRegisterCommands,
} from '../components/commandPalette/context';
import { rankItems } from '../components/commandPalette/fuzzy';
import { APP_THEME_LIST } from '../theme/appThemes';
import { STAGE_PRESETS_IN_DISPLAY_ORDER } from '../theme/stagePresets';
import { STAGE_SIZES, StageSize } from '../theme/stageSettingsStorage';
import { PLAYBACK_SPEEDS } from '../components/audio/PlaybackSpeedControl';
import { useAppTheme } from '../context/AppThemeContext';
import { lineStartAtOffset } from '../utils/lineNavigation';
import { MIX_GUIDE_MAX } from './useMixController';
import { formatSemitones } from '../utils/format';
import type { UseStudioAudioReturn } from './useStudioAudio';
import type { UseMixControllerReturn } from './useMixController';
import type { UseVisualThemeReturn } from './useVisualTheme';

export interface UseStudioCommandsOptions {
  project: ProjectState | null;
  isStudioReady: boolean;
  hasUnsavedEdits: boolean;
  audio: UseStudioAudioReturn;
  mix: UseMixControllerReturn;
  theme: UseVisualThemeReturn;
  onOpenExport: () => void;
  onOpenEdit: () => void;
  onOpenDelete: () => void;
  onOpenHelp: () => void;
  onNewSong: () => void;
  onOpenProject: (project: ProjectState) => void;
  onSelectTab: (tab: StudioWorkspaceTab) => void;
}

const SONG_CACHE_MS = 30_000;
const SONG_RESULTS = 8;
const STAGE_SIZE_LABELS: Record<StageSize, string> = {
  compact: 'Compact',
  standard: 'Standard',
  large: 'Large',
};
const GUIDE_LEVELS = [
  { id: 'off', label: 'off', value: 0 },
  { id: 'subtle', label: 'subtle', value: MIX_GUIDE_MAX / 2 },
  { id: 'loud', label: 'loud', value: MIX_GUIDE_MAX },
] as const;
const PANEL_FOR_TAB: Record<StudioWorkspaceTab, string> = {
  stage: 'workspace-panel-stage',
  timeline: 'workspace-panel-timeline',
  mix: 'workspace-panel-mix-audio',
};

const current = (isCurrent: boolean) => (isCurrent ? 'Current' : undefined);

function songStatus(project: ProjectState): string | undefined {
  if (project.status === 'ready') return undefined;
  if (project.status === 'error') return 'Failed';
  return 'Processing';
}

export function useStudioCommands(opts: UseStudioCommandsOptions): void {
  const { project, isStudioReady, audio, mix, theme } = opts;
  const appTheme = useAppTheme();

  const confirmDiscard = (message: string) => !opts.hasUnsavedEdits || window.confirm(message);

  const commands: PaletteCommand[] = [];
  const add = (command: PaletteCommand) => commands.push(command);

  if (isStudioReady && project) {
    const lines = project.lines ?? [];
    const now = () => audio.getCurrentTime();
    const seekToLine = (offset: -1 | 0 | 1) => {
      const target = lineStartAtOffset(lines, now(), offset);
      if (target !== null) audio.handleSeek(target);
    };

    // Playback
    add({
      id: 'play-toggle',
      title: audio.isPlaying ? 'Pause' : 'Play',
      group: 'Playback',
      icon: audio.isPlaying ? <Pause /> : <Play />,
      shortcut: ['Space'],
      keywords: ['playback', 'start', 'stop', 'resume'],
      run: audio.handleTogglePlay,
    });
    add({
      id: 'restart',
      title: 'Restart from the beginning',
      group: 'Playback',
      icon: <RotateCcw />,
      run: () => audio.handleSeek(0),
    });
    add({
      id: 'mute-toggle',
      title: audio.isMuted ? 'Unmute' : 'Mute',
      group: 'Playback',
      icon: audio.isMuted ? <Volume2 /> : <VolumeX />,
      shortcut: ['M'],
      keywords: ['sound', 'volume', 'silence'],
      run: audio.handleToggleMute,
    });
    add({
      id: 'seek-back',
      title: 'Jump back 5 seconds',
      group: 'Playback',
      icon: <Undo />,
      shortcut: ['←'],
      keywords: ['rewind'],
      run: () => audio.handleSeek(Math.max(0, now() - 5)),
    });
    add({
      id: 'seek-forward',
      title: 'Jump forward 5 seconds',
      group: 'Playback',
      icon: <Redo />,
      shortcut: ['→'],
      keywords: ['skip', 'fast forward'],
      run: () => audio.handleSeek(Math.min(audio.duration || Infinity, now() + 5)),
    });
    add({
      id: 'line-previous',
      title: 'Previous lyric line',
      group: 'Playback',
      icon: <SkipBack />,
      shortcut: ['['],
      run: () => seekToLine(-1),
    });
    add({
      id: 'line-next',
      title: 'Next lyric line',
      group: 'Playback',
      icon: <SkipForward />,
      shortcut: [']'],
      run: () => seekToLine(1),
    });
    add({
      id: 'line-replay',
      title: 'Replay the current line',
      group: 'Playback',
      icon: <RotateCcw />,
      shortcut: ['R'],
      keywords: ['again', 'repeat'],
      run: () => seekToLine(0),
    });
    PLAYBACK_SPEEDS.forEach((rate) =>
      add({
        id: `speed:${rate}`,
        title: `Playback speed ${rate}x`,
        subtitle: current(Math.abs(audio.playbackRate - rate) < 0.01),
        group: 'Playback',
        icon: <Gauge />,
        keywords: ['tempo', 'slow', 'fast', 'rate', 'practice'],
        run: () => audio.setPlaybackRate(rate),
      })
    );

    // Stage
    add({
      id: 'visualizer-toggle',
      title: theme.showVisualizer ? 'Hide beat visualizer' : 'Show beat visualizer',
      group: 'Stage',
      icon: <Sparkles />,
      shortcut: ['V'],
      keywords: ['spectrum', 'bars', 'audio'],
      run: theme.toggleVisualizer,
    });
    add({
      id: 'chordbar-toggle',
      title: theme.showChordBar ? 'Hide chord bar' : 'Show chord bar',
      group: 'Stage',
      icon: <ListMusic />,
      shortcut: ['C'],
      keywords: ['chords', 'harmony'],
      run: theme.toggleChordBar,
    });
    add({
      id: 'sync-word',
      title: 'Highlight lyrics word by word',
      subtitle: current(theme.syncMode === 'word'),
      group: 'Stage',
      icon: <Sparkles />,
      keywords: ['sweep', 'karaoke', 'kf'],
      run: () => theme.setSyncMode('word'),
    });
    add({
      id: 'sync-line',
      title: 'Highlight whole lines',
      subtitle: current(theme.syncMode === 'line'),
      group: 'Stage',
      icon: <LayoutPanelTop />,
      keywords: ['line by line'],
      run: () => theme.setSyncMode('line'),
    });
    STAGE_SIZES.forEach((size) =>
      add({
        id: `stage-size:${size}`,
        title: `Studio preview size: ${STAGE_SIZE_LABELS[size]}`,
        subtitle: current(theme.stageSize === size),
        group: 'Stage',
        icon: <Maximize2 />,
        keywords: ['bigger', 'smaller', 'stage height'],
        run: () => theme.setStageSize(size),
      })
    );
    add({
      id: 'format:16:9',
      title: 'Video format: 16:9 widescreen',
      subtitle: current(theme.aspectRatio !== '9:16'),
      group: 'Stage',
      icon: <Monitor />,
      keywords: ['landscape', 'youtube'],
      run: () => theme.setAspectRatio('16:9'),
    });
    add({
      id: 'format:9:16',
      title: 'Video format: 9:16 Shorts',
      subtitle: current(theme.aspectRatio === '9:16'),
      group: 'Stage',
      icon: <Smartphone />,
      keywords: ['portrait', 'vertical', 'tiktok', 'reels'],
      run: () => theme.setAspectRatio('9:16'),
    });
    add({
      id: 'stage-reset',
      title: 'Reset stage colors and lyric size',
      group: 'Stage',
      icon: <RotateCcw />,
      run: theme.resetThemeDefaults,
    });

    // Mix
    add({
      id: 'key-up',
      title: 'Raise key one semitone',
      subtitle: `Now: ${formatSemitones(mix.semitones)}`,
      group: 'Mix',
      icon: <Plus />,
      keywords: ['pitch', 'transpose', 'higher'],
      keepOpen: true,
      run: () => mix.stepSemitones(1),
    });
    add({
      id: 'key-down',
      title: 'Lower key one semitone',
      subtitle: `Now: ${formatSemitones(mix.semitones)}`,
      group: 'Mix',
      icon: <Minus />,
      keywords: ['pitch', 'transpose', 'deeper'],
      keepOpen: true,
      run: () => mix.stepSemitones(-1),
    });
    add({
      id: 'key-reset',
      title: 'Back to the original key',
      group: 'Mix',
      icon: <RotateCcw />,
      keywords: ['pitch', 'transpose'],
      run: mix.resetSemitones,
    });
    GUIDE_LEVELS.forEach((level) =>
      add({
        id: `guide:${level.id}`,
        title: `Guide vocal ${level.label}`,
        subtitle: current(Math.abs(mix.guideVolume - level.value) < 0.01),
        group: 'Mix',
        icon: <Mic />,
        keywords: ['vocals', 'singer', 'backing'],
        run: () => mix.commitGuideVolume(level.value),
      })
    );

    // Song
    add({
      id: 'export',
      title: 'Export video, subtitles & stems…',
      group: 'Song',
      icon: <Upload />,
      keywords: ['render', 'download', 'youtube', 'mp4', 'lrc', 'ass'],
      run: opts.onOpenExport,
    });
    add({
      id: 'edit-details',
      title: 'Edit song details…',
      group: 'Song',
      icon: <Pencil />,
      keywords: ['title', 'artist', 'rename'],
      run: opts.onOpenEdit,
    });
    add({
      id: 'delete-project',
      title: 'Delete project…',
      group: 'Song',
      icon: <Trash2 />,
      keywords: ['remove'],
      run: opts.onOpenDelete,
    });

    // Navigate (switches the phone tabs; focuses the panel everywhere)
    (
      [
        ['stage', 'Go to stage'],
        ['timeline', 'Go to timeline'],
        ['mix', 'Go to mix & theme'],
      ] as const
    ).forEach(([tab, title]) =>
      add({
        id: `goto:${tab}`,
        title,
        group: 'Navigate',
        icon: <Layers />,
        run: () => {
          opts.onSelectTab(tab);
          window.requestAnimationFrame(() =>
            document.getElementById(PANEL_FOR_TAB[tab])?.focus({ preventScroll: false })
          );
        },
      })
    );

    STAGE_PRESETS_IN_DISPLAY_ORDER.forEach((preset) =>
      add({
        id: `stage-preset:${preset.id}`,
        title: `Stage preset: ${preset.name}`,
        subtitle: current(theme.selectedTheme.id === preset.id),
        group: 'Themes',
        icon: <Palette />,
        keywords: ['look', 'style', 'colors', preset.description],
        run: () => theme.setSelectedTheme(preset),
      })
    );
  }

  APP_THEME_LIST.forEach((t) =>
    add({
      id: `app-theme:${t.id}`,
      title: `App theme: ${t.name}`,
      subtitle: current(appTheme.themeId === t.id),
      group: 'Themes',
      icon: <Palette />,
      keywords: ['appearance', 'dark', 'light', 'colors'],
      run: () => appTheme.setThemeId(t.id),
    })
  );

  if (project) {
    add({
      id: 'new-song',
      title: 'New song',
      group: 'Song',
      icon: <Music />,
      keywords: ['library', 'search', 'home', 'back'],
      run: () => {
        if (confirmDiscard('You have unsaved lyric edits. Discard them and start a new song?')) {
          opts.onNewSong();
        }
      },
    });
  }
  add({
    id: 'help',
    title: 'Help & keyboard shortcuts',
    group: 'Help',
    icon: <HelpCircle />,
    shortcut: ['?'],
    keywords: ['guide', 'keys', 'how to'],
    run: opts.onOpenHelp,
  });

  useRegisterCommands('studio', commands);

  // Song search across the library (fetched lazily, cached briefly)
  const cache = useRef<{ at: number; songs: ProjectState[] } | null>(null);
  const inFlight = useRef<Promise<ProjectState[]> | null>(null);
  const fetchSongs = useCallback((): Promise<ProjectState[]> => {
    const cached = cache.current;
    if (cached && Date.now() - cached.at < SONG_CACHE_MS) return Promise.resolve(cached.songs);
    if (!inFlight.current) {
      inFlight.current = apiFetch('/api/projects?scope=all')
        .then((res) => (res.ok ? res.json() : {}))
        .then((data: Record<string, ProjectState>) => {
          // The API lists projects under every alias; keep one entry per id
          const byId = new Map<string, ProjectState>();
          Object.values(data || {}).forEach((p) => {
            if (p?.id && !byId.has(p.id)) byId.set(p.id, p);
          });
          const songs = Array.from(byId.values()).reverse();
          cache.current = { at: Date.now(), songs };
          return songs;
        })
        .finally(() => {
          inFlight.current = null;
        });
    }
    return inFlight.current;
  }, []);

  const currentProjectId = project?.id;
  useRegisterCommandSource({
    id: 'songs',
    group: 'Songs',
    minQueryLength: 1,
    warm: () => {
      fetchSongs().catch(() => {});
    },
    load: async (query) => {
      const songs = await fetchSongs();
      return rankItems(
        query,
        songs
          .filter((p) => p.id !== currentProjectId)
          .map((p) => {
            const title = p.title || 'Untitled song';
            return {
              id: `song:${p.id}`,
              title,
              subtitle: [p.artist, songStatus(p)].filter(Boolean).join(' · ') || undefined,
              group: 'Songs',
              icon: <Music />,
              keywords: p.created_by ? [p.created_by] : undefined,
              transient: true,
              run: () => {
                if (
                  confirmDiscard(`You have unsaved lyric edits. Discard them and open "${title}"?`)
                ) {
                  opts.onOpenProject(p);
                }
              },
            };
          }),
        SONG_RESULTS
      );
    },
  });
}
