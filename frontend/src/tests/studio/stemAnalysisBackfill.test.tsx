/**
 * A song opens before its vocal range and chords are analysed (the intake analyses them
 * while the studio opens). The studio asks for each once and puts the answer on the song.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useVocalRangeBackfill } from '../../hooks/useVocalRangeBackfill';
import { useProjectChords } from '../../hooks/useProjectChords';
import { ToastProvider } from '../../hooks/useToast';
import { ProjectState } from '../../types';

const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  readApiError: async () => 'error',
}));

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const VOCAL_RANGE = {
  lowest_note: 'A2',
  highest_note: 'E4',
  estimated_key: 'G major',
  is_voiced: true,
};

const song = (overrides: Partial<ProjectState> = {}): ProjectState =>
  ({
    id: 'song-1',
    status: 'ready',
    progress: 100,
    lines: [],
    semitones: 0,
    guide_volume: 0,
    vocals_url: '/static/stems/song-1/vocals.wav',
    ...overrides,
  }) as ProjectState;

function useSong(initial: ProjectState) {
  const [project, setProject] = useState<ProjectState | null>(initial);
  return { project, setProject };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

const callsTo = (fragment: string) =>
  mockApiFetch.mock.calls.filter(([url]) => String(url).includes(fragment)).length;

describe('vocal range backfill', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('fetches the vocal range of a ready song that has none, once', async () => {
    mockApiFetch.mockImplementation(() => json(VOCAL_RANGE));
    const { result, rerender } = renderHook(
      () => {
        const state = useSong(song());
        useVocalRangeBackfill(state);
        return state;
      },
      { wrapper }
    );

    await waitFor(() => expect(result.current.project?.vocal_range?.estimated_key).toBe('G major'));
    rerender();
    expect(callsTo('/vocal-range')).toBe(1);
    expect(mockApiFetch).toHaveBeenCalledWith('/api/project/song-1/vocal-range');
  });

  it('leaves songs alone that are processing, already analysed or have no vocal stem', () => {
    mockApiFetch.mockImplementation(() => json(VOCAL_RANGE));
    for (const project of [
      song({ status: 'aligning' }),
      song({ vocal_range: VOCAL_RANGE as ProjectState['vocal_range'] }),
      song({ vocals_url: undefined }),
    ]) {
      renderHook(
        () => {
          const state = useSong(project);
          useVocalRangeBackfill(state);
          return state;
        },
        { wrapper }
      );
    }
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('does not ask again after a failed analysis', async () => {
    mockApiFetch.mockImplementation(() => json({ detail: 'no stem' }, 400));
    const { result, rerender } = renderHook(
      () => {
        const state = useSong(song());
        useVocalRangeBackfill(state);
        return state;
      },
      { wrapper }
    );
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      result.current.setProject((prev) => (prev ? { ...prev, title: 'Renamed' } : prev));
    });
    rerender();
    expect(result.current.project?.vocal_range).toBeUndefined();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('chord backfill', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('asks once for a song whose detection found no chords', async () => {
    mockApiFetch.mockImplementation(() => json({ project_id: 'song-1', chords: [] }));
    const { result, rerender } = renderHook(
      () => {
        const state = useSong(song());
        useProjectChords({ ...state, isStudioReady: true });
        return state;
      },
      { wrapper }
    );

    await waitFor(() => expect(result.current.project?.chords).toEqual([]));
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(callsTo('/chords')).toBe(1);
  });

  it('puts chords that arrive after the song opened on the song', async () => {
    const chords = [{ chord: 'G', start: 0, end: 2 }];
    mockApiFetch.mockImplementation(() => json({ project_id: 'song-1', chords }));
    const { result } = renderHook(
      () => {
        const state = useSong(song());
        useProjectChords({ ...state, isStudioReady: true });
        return state;
      },
      { wrapper }
    );

    await waitFor(() => expect(result.current.project?.chords).toEqual(chords));
    expect(callsTo('/chords')).toBe(1);
  });
});
