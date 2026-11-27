/**
 * The song's melody for practice: asked of the server only once it is wanted, once per song
 * and set of vocals, and "missing" in plain terms when the song has none.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMelody, type UseMelodyOptions } from '../../hooks/useMelody';
import { PRACTICE_MELODY } from '../helpers/practiceFixtures';

let answer: () => Response | Promise<Response>;
let fetchSpy: MockInstance<typeof fetch>;

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function setup(overrides: Partial<UseMelodyOptions> = {}) {
  const initial: UseMelodyOptions = {
    wanted: true,
    projectId: 'song',
    vocalsUrl: '/static/stems/song/vocals.wav',
    ...overrides,
  };
  const hook = renderHook((props: UseMelodyOptions) => useMelody(props), {
    initialProps: initial,
  });
  return { ...hook, initial };
}

describe('useMelody', () => {
  beforeEach(() => {
    answer = () => ok(PRACTICE_MELODY);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer());
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not ask until the melody is wanted', () => {
    const { result } = setup({ wanted: false });
    expect(result.current).toEqual({ melody: null, status: 'idle' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks for the song’s melody, and has it', async () => {
    const { result } = setup();
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.melody).toEqual(PRACTICE_MELODY);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/project/song/melody');
  });

  it('asks once, however often the studio renders', async () => {
    const { result, rerender, initial } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...initial });
    rerender({ ...initial, wanted: false });
    rerender({ ...initial, wanted: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
  });

  it('keeps the melody while it is not wanted, without showing it as idle', async () => {
    const { result, rerender, initial } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...initial, wanted: false });
    expect(result.current.melody).toEqual(PRACTICE_MELODY);
  });

  it('asks again for another song, and never shows the last song’s melody for it', async () => {
    const { result, rerender, initial } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    rerender({ ...initial, projectId: 'another', vocalsUrl: '/static/stems/another/vocals.wav' });

    expect(result.current.melody).toBeNull();
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/project/another/melody');
  });

  it('asks again when the song gets new vocals', async () => {
    const { result, rerender, initial } = setup();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ ...initial, vocalsUrl: '/static/stems/song/vocals.wav?v=2' });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('is missing for a song with nothing sung', async () => {
    answer = () => ok({ ...PRACTICE_MELODY, detected: false, midi: [], low: null, high: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.melody).toBeNull();
  });

  it('is missing when the server refuses or answers something else', async () => {
    answer = () => new Response(JSON.stringify({ detail: 'no vocals' }), { status: 400 });
    const refused = setup();
    await waitFor(() => expect(refused.result.current.status).toBe('missing'));

    answer = () => ok({ hello: 'world' });
    const odd = setup({ projectId: 'odd' });
    await waitFor(() => expect(odd.result.current.status).toBe('missing'));
  });

  it('is missing when the server cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    const { result } = setup();
    await waitFor(() => expect(result.current.status).toBe('missing'));
  });

  it('is missing at once for a song without vocals', () => {
    const { result } = setup({ vocalsUrl: undefined });
    expect(result.current.status).toBe('missing');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
