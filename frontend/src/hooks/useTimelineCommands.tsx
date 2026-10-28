/**
 * Timeline commands for the command palette: lyric editing actions plus a lyric-line search
 * source (picking a line seeks to it and selects it in the timeline).
 */

import React from 'react';
import {
  AudioWaveform,
  Clock,
  Hand,
  ListChecks,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  TextQuote,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';
import { LyricLine } from '../types';
import {
  PaletteCommand,
  useRegisterCommandSource,
  useRegisterCommands,
} from '../components/commandPalette/context';
import { rankItems } from '../components/commandPalette/fuzzy';
import { formatTime } from '../utils/format';
import type { TimelineFilter } from './useTimelineFilter';

export interface UseTimelineCommandsOptions {
  lines: LyricLine[];
  hasUnsavedChanges: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isTapToSyncActive: boolean;
  reviewCount: number;
  filter: TimelineFilter;
  onSave: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenOffset: () => void;
  onOpenDuet: () => void;
  onOpenReplace: () => void;
  onToggleTapToSync: () => void;
  onFilterChange: (filter: TimelineFilter) => void;
  onAddLine: () => void;
  /** Seek to and select a line (used by lyric search results). */
  onGoToLine: (line: LyricLine) => void;
}

const GROUP = 'Lyrics';
const LINE_RESULTS = 8;

export function useTimelineCommands(opts: UseTimelineCommandsOptions): void {
  const commands: PaletteCommand[] = [];
  if (opts.hasUnsavedChanges) {
    commands.push(
      {
        id: 'lyrics-save',
        title: 'Save lyric changes',
        group: GROUP,
        icon: <Save />,
        keywords: ['timing', 'store'],
        run: opts.onSave,
      },
      {
        id: 'lyrics-discard',
        title: 'Discard lyric changes…',
        group: GROUP,
        icon: <Trash2 />,
        keywords: ['revert', 'reset'],
        run: opts.onDiscard,
      }
    );
  }
  if (opts.canUndo) {
    commands.push({
      id: 'lyrics-undo',
      title: 'Undo lyric edit',
      group: GROUP,
      icon: <Undo2 />,
      shortcut: ['Mod', 'Z'],
      run: opts.onUndo,
    });
  }
  if (opts.canRedo) {
    commands.push({
      id: 'lyrics-redo',
      title: 'Redo lyric edit',
      group: GROUP,
      icon: <Redo2 />,
      shortcut: ['Mod', 'Y'],
      run: opts.onRedo,
    });
  }
  commands.push(
    {
      id: 'lyrics-tap-sync',
      title: opts.isTapToSyncActive ? 'Stop tap-to-sync' : 'Start tap-to-sync',
      group: GROUP,
      icon: <Hand />,
      shortcut: ['T'],
      keywords: ['stamp', 'timing', 'live'],
      run: opts.onToggleTapToSync,
    },
    {
      id: 'lyrics-offset',
      title: 'Shift timings (batch offset)…',
      group: GROUP,
      icon: <Clock />,
      keywords: ['delay', 'early', 'late', 'sync'],
      run: opts.onOpenOffset,
    },
    {
      id: 'lyrics-duet',
      title: 'Assign duet parts…',
      group: GROUP,
      icon: <Users />,
      keywords: ['singer', 'partner', 'both'],
      run: opts.onOpenDuet,
    },
    {
      id: 'lyrics-replace',
      title: 'Replace or re-align lyrics…',
      group: GROUP,
      icon: <RefreshCw />,
      keywords: ['lrc', 'paste', 'lrclib', 'import'],
      run: opts.onOpenReplace,
    },
    {
      id: 'lyrics-add-line',
      title: 'Add a lyric line at the end',
      group: GROUP,
      icon: <Plus />,
      run: opts.onAddLine,
    }
  );
  if (opts.filter === 'review') {
    commands.push({
      id: 'lyrics-review-filter',
      title: 'Show all lyric lines',
      group: GROUP,
      icon: <ListChecks />,
      run: () => opts.onFilterChange('all'),
    });
  } else if (opts.reviewCount > 0) {
    commands.push({
      id: 'lyrics-review-filter',
      title: `Show lines that need review (${opts.reviewCount})`,
      group: GROUP,
      icon: <ListChecks />,
      keywords: ['confidence', 'check', 'problems'],
      run: () => opts.onFilterChange('review'),
    });
  }
  useRegisterCommands('timeline', commands);

  useRegisterCommandSource({
    id: 'lyric-lines',
    group: 'Lyric lines',
    minQueryLength: 2,
    load: (query) =>
      rankItems(
        query,
        opts.lines.map((line, index) => ({
          id: `line:${line.id}`,
          title: line.text || `Line ${index + 1}`,
          subtitle: `Line ${index + 1} · ${formatTime(line.start_time)}`,
          group: 'Lyric lines',
          transient: true,
          icon: line.words?.length ? <AudioWaveform /> : <TextQuote />,
          run: () => opts.onGoToLine(line),
        })),
        LINE_RESULTS
      ),
  });
}
