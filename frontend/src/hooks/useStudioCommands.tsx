/**
 * Studio commands for the command palette: playback, stage, mix, themes, song actions and
 * navigation, plus a song search source across the library.
 */

import React, { useCallback, useRef } from 'react';
import {
  Download,
  Gauge,
  HelpCircle,
  ImageIcon,
  Layers,
  LayoutPanelTop,
  ListChecks,
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
  Stethoscope,
  Trash2,
  Undo,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
  Highlighter,
} from 'lucide-react';
import { ProjectState, StudioWorkspaceTab } from '../types';
import { apiFetch } from '../api';
import {
  PaletteCommand,
  useRegisterCommandSource,
  useRegisterCommands,
} from '../components/commandPalette/context';
import { rankItems } from '../components/commandPalette/fuzzy';
import { STAGE_PRESETS_IN_DISPLAY_ORDER } from '../theme/stagePresets';
import { STAGE_BACKGROUND_OPTIONS } from '../theme/stageBackgrounds';
import { STAGE_SIZES, StageSize } from '../theme/stageSettingsStorage';
import { PLAYBACK_SPEEDS } from '../components/audio/PlaybackSpeedControl';
import { lineStartAtOffset } from '../utils/lineNavigation';
import { MIX_GUIDE_MAX } from './useMixController';
import { formatSemitones } from '../utils/format';
import type { UseStudioAudioReturn } from './useStudioAudio';
import type { UseMixControllerReturn } from './useMixController';
import type { UseVisualThemeReturn } from './useVisualTheme';
import type { UseQualityJobsReturn } from './useQualityJobs';
import { stemsLabel } from '../utils/quality';
import { checkupFixCount } from '../utils/songCheckup';
import { focusWorkspacePanel } from '../components/studio/workspacePanels';
import { isActiveJobStatus, vocalSplitBusyReason } from '../utils/jobs';

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
  /** Opens the song check-up (adds "Song check-up…"). */
  onOpenCheckup?: () => void;
  /** Brings back the getting-started card; omitted while it is showing. */
  onShowFirstSongSteps?: () => void;
  onNewSong: () => void;
  onOpenProject: (project: ProjectState) => void;
  onSelectTab: (tab: StudioWorkspaceTab) => void;
  /** Stem re-separation actions (adds "Improve stem separation…"). */
  quality?: UseQualityJobsReturn;
  /** Installs the studio as an app; omitted when this browser can't install it. */
  onInstallApp?: () => void;
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

const BACKING_LEVELS = [
  { id: 'off', label: 'removed', value: 0 },
  { id: 'full', label: 'kept in', value: 1 },
] as const;

const current = (isCurrent: boolean) => (isCurrent ? 'Current' : undefined);

function songStatus(project: ProjectState): string | undefined {
  if (project.status === 'ready') return undefined;
  if (project.status === 'error') return 'Failed';
  return 'Processing';
}

export function useStudioCommands(opts: UseStudioCommandsOptions): void {
  const { project, isStudioReady, audio, mix, theme } = opts;

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
      icon: <Highlighter />,
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
      icon: <Highlighter />,
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

    // Stems: re-make them at another quality, or stop a re-separation
    const { quality } = opts;
    if (quality && isActiveJobStatus(project.separation_job?.status)) {
      add({
        id: 'stems-cancel',
        title: 'Cancel stem re-separation',
        subtitle: project.separation_job?.detail,
        group: 'Mix',
        icon: <X />,
        keywords: ['stop', 'separation', 'stems'],
        run: () => quality.cancelReseparation(),
      });
    } else if (quality && !isActiveJobStatus(project.sync_job?.status)) {
      add({
        id: 'stems-improve',
        title: 'Improve stem separation…',
        subtitle: `Now: ${stemsLabel(project.separation)}`,
        group: 'Mix',
        icon: <Highlighter />,
        keywords: [
          'separation',
          'stems',
          'vocals',
          'instrumental',
          'quality',
          'roformer',
          'demucs',
        ],
        run: quality.openReseparate,
      });
    }

    // Vocal parts: the backing vocals' level once they are split from the lead
    if (project.vocal_splits?.lead_backing) {
      const backing = mix.vocalLevels.backing ?? mix.guideVolume;
      BACKING_LEVELS.forEach((level) =>
        add({
          id: `backing:${level.id}`,
          title: `Backing vocals ${level.label}`,
          subtitle: current(Math.abs(backing - level.value) < 0.01),
          group: 'Mix',
          icon: <Users />,
          keywords: ['vocals', 'harmony', 'harmonies', 'choir', 'keep', 'remove'],
          run: () => mix.commitVocalLevels({ ...mix.vocalLevels, backing: level.value }),
        })
      );
    }

    // Vocal parts: split the backing vocals from the lead, or stop a split
    if (quality && isActiveJobStatus(project.vocal_split_job?.status)) {
      add({
        id: 'vocals-split-cancel',
        title: 'Cancel vocal split',
        subtitle: project.vocal_split_job?.detail,
        group: 'Mix',
        icon: <X />,
        keywords: ['stop', 'backing', 'lead', 'vocals'],
        run: () => quality.cancelVocalSplit(),
      });
    } else if (quality && !vocalSplitBusyReason(project)) {
      if (!project.vocal_splits?.lead_backing) {
        add({
          id: 'vocals-split',
          title: 'Split lead and backing vocals',
          subtitle: 'To keep the backing vocals in the mix',
          group: 'Mix',
          icon: <Users />,
          keywords: ['backing', 'lead', 'vocals', 'harmony', 'harmonies', 'choir', 'stems'],
          run: () => quality.startVocalSplit('lead_backing'),
        });
      }
      if (!project.vocal_splits?.male_female) {
        add({
          id: 'vocals-split-voices',
          title: 'Split male and female voices',
          subtitle: 'To keep one voice of a duet in the mix',
          group: 'Mix',
          icon: <Users />,
          keywords: ['duet', 'man', 'woman', 'partner', 'vocals', 'singer', 'stems'],
          run: () => quality.startVocalSplit('male_female'),
        });
      }
    }

    // Song
    const { onOpenCheckup } = opts;
    if (onOpenCheckup) {
      const toFix = checkupFixCount(project);
      add({
        id: 'song-checkup',
        title: 'Song check-up: what to fix…',
        subtitle: toFix > 0 ? `${toFix} to look at` : 'Nothing to fix',
        group: 'Song',
        icon: <Stethoscope />,
        keywords: ['problem', 'wrong', 'quality', 'lyrics', 'timing', 'stems', 'troubleshoot'],
        run: onOpenCheckup,
      });
    }
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
          focusWorkspacePanel(tab);
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

  if (project) {
    add({
      id: 'new-song',
      title: 'New Song',
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
  if (isStudioReady && opts.onShowFirstSongSteps) {
    add({
      id: 'first-song-steps',
      title: 'Show the first-song steps',
      subtitle: 'Play, check the lyrics, set your key, make a video',
      group: 'Help',
      icon: <ListChecks />,
      keywords: ['getting started', 'tutorial', 'intro', 'new', 'how to', 'guide'],
      run: opts.onShowFirstSongSteps,
    });
  }
  if (opts.onInstallApp) {
    add({
      id: 'install-app',
      title: 'Install app',
      subtitle: 'Add Karaoke Studio to your home screen',
      group: 'Help',
      icon: <Download />,
      keywords: ['pwa', 'home screen', 'add', 'phone', 'desktop', 'shortcut'],
      run: opts.onInstallApp,
    });
  }

  // After the stage presets, so the list shown before typing keeps its entries
  if (project) {
    STAGE_BACKGROUND_OPTIONS.forEach((option) =>
      add({
        id: `stage-background:${option.value}`,
        title: `Stage background: ${option.label}`,
        subtitle: current(theme.backgroundStyle === option.value),
        group: 'Themes',
        icon: <ImageIcon />,
        keywords: ['backdrop', 'look', option.hint],
        run: () => theme.setBackgroundStyle(option.value),
      })
    );
    if (theme.customBgId) {
      add({
        id: 'stage-background:custom',
        title: 'Stage background: Upload',
        subtitle: current(theme.backgroundStyle === 'custom'),
        group: 'Themes',
        icon: <ImageIcon />,
        keywords: ['backdrop', 'look', 'image', 'video', 'uploaded'],
        run: () => theme.setBackgroundStyle('custom'),
      });
    }
  }

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
