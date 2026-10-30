import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { StudioMetaHeader } from '../components/StudioMetaHeader';
import { useLyricEditorState } from '../hooks/useLyricEditorState';
import { ToastProvider } from '../hooks/useToast';
import { markManualEdits } from '../utils/manualEdits';
import { confidenceLevel, confidenceText, realignBounds } from '../utils/lineRealign';
import { getLyricSyncFidelity, getStemsBadge } from '../utils/syncStatus';
import type { LyricLine, ProjectState, RealignLineResult } from '../types';
import { json, mockStudioFetch } from './helpers/qualityFixtures';

const words = (text: string, start: number, step = 0.5) =>
  text.split(' ').map((word, i) => ({
    word,
    start_time: start + i * step,
    end_time: start + i * step + 0.4,
  }));

const timed = (id: number, text: string, start: number, extra: Partial<LyricLine> = {}) => ({
  id,
  text,
  start_time: start,
  end_time: start + 2,
  words: words(text, start),
  ...extra,
});

const aligned: LyricLine[] = [
  timed(1, 'one two three', 1, { align_method: 'ctc', confidence: 0.92 }),
  timed(2, 'four five six', 6, { align_method: 'dsp', confidence: 0.7 }),
  timed(3, 'seven eight', 11, { align_method: 'dsp', confidence: 0.41 }),
  timed(4, 'nine ten', 15, { align_method: 'manual' }),
];

describe('Hand edits drop the aligner confidence', () => {
  it('marks changed lines as manual and leaves the rest alone', () => {
    const next = aligned.map((l) => (l.id === 2 ? { ...l, start_time: 6.2 } : l));
    const result = markManualEdits(aligned, next, aligned);
    expect(result[0]).toBe(aligned[0]);
    expect(result[1]).toMatchObject({ id: 2, start_time: 6.2, align_method: 'manual' });
    expect(result[1]).not.toHaveProperty('confidence');
    expect(result[3]).toBe(aligned[3]);
  });

  it('matches lines by content, so renumbering after an insert changes nothing', () => {
    const inserted = timed(2, 'New lyric line', 4);
    const next = [aligned[0], inserted, ...aligned.slice(1)].map((l, i) => ({ ...l, id: i + 1 }));
    const result = markManualEdits(aligned, next, aligned);
    expect(result[1]).toMatchObject({ text: 'New lyric line', align_method: 'manual' });
    expect(result.slice(2).map((l) => [l.align_method, l.confidence])).toEqual([
      ['dsp', 0.7],
      ['dsp', 0.41],
      ['manual', undefined],
    ]);
  });

  it('gives a line its saved metadata back when it is edited back, and ignores singer changes', () => {
    const nudged = markManualEdits(
      aligned,
      aligned.map((l) => (l.id === 1 ? { ...l, start_time: 1.2 } : l)),
      aligned
    );
    const back = markManualEdits(
      nudged,
      nudged.map((l) => (l.id === 1 ? { ...l, start_time: 1 } : l)),
      aligned
    );
    expect(back[0]).toBe(aligned[0]);
    const duet = markManualEdits(
      aligned,
      aligned.map((l) => (l.id === 2 ? { ...l, singer: 'singer2' as const } : l)),
      aligned
    );
    expect(duet[1]).toMatchObject({ singer: 'singer2', align_method: 'dsp', confidence: 0.7 });
  });

  it('applies through the editor: nudges mark lines, aligner results and undo do not', () => {
    const { result } = renderHook(() =>
      useLyricEditorState({ lines: aligned, currentTime: 0, duration: 30, onSaveLines: vi.fn() })
    );
    act(() => result.current.nudgeLine(2, 0.2));
    expect(result.current.editableLines[1]).toMatchObject({ align_method: 'manual' });
    expect(result.current.editableLines[1].confidence).toBeUndefined();
    act(() => result.current.nudgeLine(2, -0.2));
    expect(result.current.editableLines[1]).toEqual(aligned[1]);
    expect(result.current.hasUnsavedChanges).toBe(false);

    const realigned = {
      ...aligned[2],
      start_time: 11.3,
      align_method: 'ctc' as const,
      confidence: 0.88,
    };
    act(() => result.current.applyRealignedLine(3, realigned));
    expect(result.current.editableLines[2]).toMatchObject({
      start_time: 11.3,
      align_method: 'ctc',
      confidence: 0.88,
    });
    act(() => result.current.handleUndo());
    expect(result.current.editableLines[2]).toEqual(aligned[2]);

    const fromServer = aligned.map((l) => ({
      ...l,
      align_method: 'ctc' as const,
      confidence: 0.99,
    }));
    act(() => result.current.adoptServerLines(fromServer));
    expect(result.current.editableLines).toBe(fromServer);
    expect(result.current.hasUnsavedChanges).toBe(false);
  });
});

describe('Sync badge and stems badge', () => {
  const base: ProjectState = {
    id: 'badge',
    title: 'Badge Song',
    artist: 'Artist',
    status: 'ready',
    progress: 100,
    lines: aligned,
    semitones: 0,
    guide_volume: 0,
  };

  it('shows auto-aligned plain lyrics as synced words with their quality', () => {
    const project: ProjectState = {
      ...base,
      is_synced: false,
      lyric_timing: 'aligned',
      sync_report: {
        version: 1,
        engine: 'ctc',
        lines_total: 4,
        mean_confidence: 0.86,
        low_confidence_lines: 1,
      },
    };
    render(
      <StudioMetaHeader project={project} onOpenEditModal={vi.fn()} onOpenDeleteModal={vi.fn()} />
    );
    const badge = screen.getByTestId('sync-status-badge');
    expect(badge).toHaveTextContent('Synced Words');
    expect(badge).toHaveTextContent('86%');
    expect(badge).toHaveTextContent('auto-aligned');
    expect(getLyricSyncFidelity(project).tooltipText).toBe(
      'High-fidelity word-level karaoke synchronization active · auto-aligned from plain lyrics by the neural aligner · 86% average confidence · 1 line needs review'
    );
    expect(screen.getByTestId('stems-badge')).toHaveTextContent('Fast stems');
  });

  it('reads older songs without lyric_timing, lyrics-file timing and low quality', () => {
    expect(getLyricSyncFidelity({ ...base, is_synced: false }).autoAligned).toBe(true);
    const fromFile = getLyricSyncFidelity({
      ...base,
      is_synced: true,
      lyric_timing: 'source_word',
    });
    expect(fromFile.autoAligned).toBe(false);
    expect(fromFile.tooltipText).toContain('word timing from the lyrics file');
    const shaky = getLyricSyncFidelity({
      ...base,
      sync_report: { version: 1, engine: 'dsp', lines_total: 4, mean_confidence: 0.42 },
    });
    expect(shaky.quality).toBe(42);
    expect(shaky.tone).toBe('warning');
    expect(getLyricSyncFidelity({ ...base, lines: [] }).label).toBe('Plain Lyrics');
  });

  it('show background jobs while they run', () => {
    const busy: ProjectState = {
      ...base,
      sync_job: { id: 's', status: 'running', mode: 'lines', progress: 40 },
      separation_job: {
        id: 'j',
        status: 'running',
        quality: 'best',
        progress: 42,
        detail: 'chunk 4/9',
      },
      separation: { preset: 'balanced' },
    };
    const sync = getLyricSyncFidelity(busy);
    expect(sync.label).toBe('Re-aligning');
    expect(sync.tooltipText).toMatch(/40%.*synchronization/);
    expect(getStemsBadge(busy)).toEqual({
      text: 'Re-making stems · 42%',
      tooltip: 'chunk 4/9',
      active: true,
    });
    expect(
      getStemsBadge({ ...base, separation: { preset: 'balanced', fallback_reason: 'no GPU' } })
    ).toEqual({
      text: 'Balanced stems',
      tooltip: 'Stems: Balanced · Mel-Band RoFormer (fell back: no GPU)',
      active: false,
    });
  });
});

describe('Confidence in the timeline', () => {
  it('rates and describes line confidence', () => {
    expect([0.92, 0.7, 0.41, undefined].map((c) => confidenceLevel(c))).toEqual([
      'high',
      'medium',
      'low',
      null,
    ]);
    expect(confidenceText(aligned[0])).toBe('Sync confidence 92% (neural aligner)');
    expect(confidenceText(aligned[3])).toBeNull();
  });

  it('puts a confidence dot on each scored line', () => {
    render(
      <LyricTimelineEditor
        lines={aligned}
        currentTime={0}
        duration={30}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
      />
    );
    expect(screen.getByTestId('line-confidence-1')).toHaveAttribute('data-level', 'high');
    expect(screen.getByTestId('line-confidence-2')).toHaveAttribute('data-level', 'medium');
    expect(screen.getByTestId('line-confidence-3')).toHaveAttribute(
      'title',
      'Sync confidence 41% (DSP aligner)'
    );
    expect(screen.queryByTestId('line-confidence-4')).toBeNull(); // timed by hand
  });

  it('bounds a re-aligned line by its neighbours of the same voice', () => {
    const duet: LyricLine[] = [
      timed(1, 'a b', 1),
      timed(2, 'c d', 2, { singer: 'singer2' }),
      timed(3, 'e f', 4),
      timed(4, 'g h', 7, { singer: 'both' }),
    ];
    expect(realignBounds(duet, 2)).toEqual({ prev_end: 3, next_start: 7 });
    expect(realignBounds(duet, 1)).toEqual({ next_start: 7 }); // singer2 has no earlier line
    expect(realignBounds(duet, 3)).toEqual({ prev_end: 6 });
    expect(realignBounds(duet, 9)).toEqual({});
  });
});

describe('Re-align this line', () => {
  const lines: LyricLine[] = [
    timed(1, 'one two three', 1, { align_method: 'dsp', confidence: 0.9 }),
    timed(2, 'four five six', 5, { align_method: 'dsp', confidence: 0.35 }),
    timed(3, 'seven eight', 11, { align_method: 'dsp', confidence: 0.8 }),
  ];
  let bodies: unknown[];
  let answer: RealignLineResult;

  beforeEach(() => {
    bodies = [];
    answer = {
      status: 'ok',
      line: {
        ...lines[1],
        start_time: 6,
        end_time: 8.2,
        words: words('four five six', 6),
        align_method: 'ctc',
        confidence: 0.93,
      },
      engine: 'ctc',
      elapsed: 0.4,
      window: [3, 8.5],
    };
    mockStudioFetch((url, init) => {
      if (url.endsWith('/realign-line')) {
        bodies.push(JSON.parse(String(init?.body)));
        return json(answer);
      }
      return undefined;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const renderEditor = (projectId?: string) =>
    render(
      <ToastProvider>
        <LyricTimelineEditor
          lines={lines}
          currentTime={0}
          duration={30}
          onSeek={vi.fn()}
          onSaveLines={vi.fn().mockResolvedValue(undefined)}
          projectId={projectId}
        />
      </ToastProvider>
    );

  it('moves the line to where it is sung, as an undoable edit', async () => {
    const user = userEvent.setup();
    renderEditor('song-1');
    await user.click(screen.getByRole('button', { name: 'More actions for line 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Re-align this line' }));

    const row = screen.getByTestId('timeline-line-2');
    await waitFor(() => expect(row).toHaveTextContent('6.0s - 8.2s'));
    expect(bodies[0]).toMatchObject({
      line: { id: 2, start_time: 5 },
      prev_end: 3,
      next_start: 11,
    });
    expect(
      await screen.findByText('Line 2 re-aligned with the neural aligner (moved +1.00s)')
    ).toBeInTheDocument();
    expect(within(row).getByTestId('line-confidence-2')).toHaveAttribute('data-level', 'high');
    expect(screen.getByTestId('save-lyrics-btn')).toBeEnabled();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(row).toHaveTextContent('5.0s - 7.0s'));
  });

  it('leaves the line alone when no singing is found nearby', async () => {
    answer = {
      ...answer,
      status: 'not_found',
      line: lines[1],
      detail: 'No singing found within 1.5 s of this line',
    };
    const user = userEvent.setup();
    renderEditor('song-1');
    await user.click(screen.getByRole('button', { name: 'More actions for line 2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Re-align this line' }));
    expect(
      await screen.findByText('No singing found within 1.5 s of this line')
    ).toBeInTheDocument();
    expect(screen.getByTestId('timeline-line-2')).toHaveTextContent('5.0s - 7.0s');
  });

  it('is only offered when the editor knows the song', async () => {
    const user = userEvent.setup();
    renderEditor(undefined);
    await user.click(screen.getByRole('button', { name: 'More actions for line 2' }));
    expect(screen.queryByRole('menuitem', { name: 'Re-align this line' })).toBeNull();
  });
});
