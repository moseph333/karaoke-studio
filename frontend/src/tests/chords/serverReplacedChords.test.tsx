/**
 * Chords the server sends for an open song (the first detection, a re-detection after new
 * stems) are the saved ones: the song is not left "unsaved", and a slow reply for one song
 * never lands on the song opened after it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useProjectChords } from '../../hooks/useProjectChords';
import type { ChordSegment, ProjectState } from '../../types';

const chords = (...names: string[]): ChordSegment[] =>
  names.map((chord, i) => ({ chord, start: i * 2, end: i * 2 + 2 }));

const song = (id: string, songChords?: ChordSegment[]): ProjectState =>
  ({ id, title: id, status: 'ready', lines: [], chords: songChords }) as unknown as ProjectState;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function renderChords(initial: ProjectState) {
  return renderHook(() => {
    const [project, setProject] = useState<ProjectState | null>(initial);
    return {
      project,
      setProject,
      ...useProjectChords({ project, setProject, isStudioReady: true }),
    };
  });
}

describe('chords replaced by the server', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('counts chords the server replaced as saved', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({}));
    const { result } = renderChords(song('a', chords('C', 'G')));
    expect(result.current.chordHistory.isDirty).toBe(false);

    // A poll after a re-detection brings a different progression
    act(() => result.current.setProject((prev) => prev && { ...prev, chords: chords('Am', 'F') }));

    expect(result.current.chordHistory.isDirty).toBe(false);
  });

  it('still shows an edit as unsaved until its save lands', async () => {
    let finishSave: (res: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => (finishSave = resolve))
    );
    const { result } = renderChords(song('a', chords('C', 'G')));

    act(() => void result.current.handleEditChord(0, 'Dm'));
    expect(result.current.project?.chords?.[0].chord).toBe('Dm');
    expect(result.current.chordHistory.isDirty).toBe(true);

    await act(async () => finishSave(json({ chords: chords('Dm', 'G') })));
    expect(result.current.chordHistory.isDirty).toBe(false);
  });

  it('drops a chords reply for a song that is no longer the open one', async () => {
    let finishA: (res: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/api/project/a/chords')) {
        return new Promise<Response>((resolve) => (finishA = resolve));
      }
      return Promise.resolve(json({ project_id: 'b', chords: chords('E', 'A') }));
    });
    const { result } = renderChords(song('a'));

    act(() => result.current.setProject(song('b')));
    await waitFor(() => expect(result.current.project?.chords?.[0].chord).toBe('E'));
    await act(async () => finishA(json({ project_id: 'a', chords: chords('C', 'G') })));

    expect(result.current.project?.chords?.map((c) => c.chord)).toEqual(['E', 'A']);
    expect(result.current.chordHistory.isDirty).toBe(false);
  });
});
