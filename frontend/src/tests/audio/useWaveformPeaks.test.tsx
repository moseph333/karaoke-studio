/**
 * Server waveform peaks: fetched for the studio project and again when its master audio
 * changes, ignored when unusable so the scrubber can fall back to decoding in the browser.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import * as apiModule from '../../api';
import { useWaveformPeaks, WAVEFORM_BINS } from '../../hooks/useWaveformPeaks';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useWaveformPeaks', () => {
  it('loads peaks for the open project', async () => {
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ peaks: [0.1, 'x', 0.9, null, 1] })));
    const { result } = renderHook(() => useWaveformPeaks('p1', true));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual([0.1, 0.9, 1]));
    expect(spy).toHaveBeenCalledWith(
      `/api/project/p1/waveform?bins=${WAVEFORM_BINS}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('stays null when the server cannot provide a waveform', async () => {
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ detail: 'not ready' }), { status: 409 }));
    const { result } = renderHook(() => useWaveformPeaks('p1', true));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });

  it('waits until the studio is ready and forgets peaks from the previous song', async () => {
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockImplementation(async () => new Response(JSON.stringify({ peaks: [0.5] })));
    const { result, rerender } = renderHook(
      ({ id, enabled }: { id: string; enabled: boolean }) => useWaveformPeaks(id, enabled),
      { initialProps: { id: 'p1', enabled: false } }
    );
    expect(spy).not.toHaveBeenCalled();

    rerender({ id: 'p1', enabled: true });
    await waitFor(() => expect(result.current).toEqual([0.5]));

    spy.mockImplementation(() => new Promise<Response>(() => {}));
    rerender({ id: 'p2', enabled: true });
    expect(result.current).toBeNull();
  });

  it('fetches again when the master audio changes, keeping the old peaks meanwhile', async () => {
    let respond: (res: Response) => void = () => {};
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ peaks: [0.2] })))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (respond = resolve)));
    const { result, rerender } = renderHook(
      ({ audio }: { audio: string }) => useWaveformPeaks('p1', true, audio),
      { initialProps: { audio: '/static/output/p1_mix_0_0.wav?v=1' } }
    );
    await waitFor(() => expect(result.current).toEqual([0.2]));

    rerender({ audio: '/static/output/p1_mix_2_0.wav?v=2' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual([0.2]);

    respond(new Response(JSON.stringify({ peaks: [0.7] })));
    await waitFor(() => expect(result.current).toEqual([0.7]));
  });
});
