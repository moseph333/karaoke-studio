import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackSearch } from '../../components/TrackSearch';
import { SEPARATION_QUALITY_STORAGE_KEY, useTrackIntake } from '../../hooks/useTrackIntake';
import {
  loadCapabilities,
  resetCapabilitiesCache,
  useCapabilities,
} from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import {
  formatDurationEstimate,
  formatTimeLeft,
  separationEstimate,
  stemsLabel,
} from '../../utils/quality';
import { CAPABILITIES, json, mockStudioFetch } from '../helpers/qualityFixtures';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

const capabilityRequests = (spy: ReturnType<typeof mockStudioFetch>) =>
  spy.mock.calls.filter(([url]) => url.toString().includes('/api/capabilities')).length;

describe('Stem quality at intake', () => {
  beforeEach(() => {
    resetCapabilitiesCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers Fast, Balanced and Best once Advanced options open, with what this server can run', async () => {
    const fetchSpy = mockStudioFetch();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TrackSearch onSelectTrack={vi.fn()} isLoading={false} onSeparationQualityChange={onChange} />
    );
    expect(capabilityRequests(fetchSpy)).toBe(0); // nothing asked until the picker shows

    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    const group = screen.getByRole('group', { name: 'Stem separation quality' });
    const balanced = within(group).getByRole('radio', { name: 'Balanced' });
    await waitFor(() => expect(balanced).toBeChecked()); // the server's effective default
    expect(capabilityRequests(fetchSpy)).toBe(1);

    const best = within(group).getByRole('radio', { name: 'Best' });
    expect(best).toBeDisabled();
    expect(best).toHaveAccessibleDescription(/Not available here: Not enough memory/);
    expect(balanced).toHaveAccessibleDescription(/about 1\.6× the song's length on CPU/);
    expect(balanced).toHaveAccessibleDescription(/Downloads its model on first use/);
    expect(within(group).getByText('Default')).toBeInTheDocument();

    await user.click(within(group).getByRole('radio', { name: 'Fast' }));
    expect(onChange).toHaveBeenCalledWith('fast');
  });

  it('shows a chosen quality in the Advanced options summary', () => {
    mockStudioFetch();
    render(
      <TrackSearch
        onSelectTrack={vi.fn()}
        isLoading={false}
        separationQuality="best"
        onSeparationQualityChange={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Advanced options' })).toHaveAccessibleDescription(
      'Best stems · Custom lyrics'
    );
  });

  it('still offers every preset when the server cannot be asked', async () => {
    mockStudioFetch(undefined, null);
    const user = userEvent.setup();
    render(
      <TrackSearch onSelectTrack={vi.fn()} isLoading={false} onSeparationQualityChange={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['fast', 'balanced', 'best']);
    expect(radios.every((r) => !(r as HTMLInputElement).disabled)).toBe(true);
  });

  it('hides the picker when the app does not handle a quality choice', async () => {
    mockStudioFetch();
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    expect(screen.queryByRole('group', { name: 'Stem separation quality' })).toBeNull();
  });

  it('sends the remembered quality with new songs and uploads, and nothing by default', async () => {
    const bodies: unknown[] = [];
    mockStudioFetch((url, init) => {
      if (url.includes('/api/process')) {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ project_id: 'p1' });
      }
      if (url.includes('/api/upload-track')) {
        bodies.push(Object.fromEntries((init?.body as FormData).entries()));
        return json({ project_id: 'p2' });
      }
      return undefined;
    });
    const setProject = vi.fn();
    const { result, unmount } = renderHook(
      () => useTrackIntake({ currentUser: 'Ana', setProject }),
      { wrapper }
    );
    expect(result.current.separationQuality).toBeNull();
    await act(() => result.current.handleSelectTrack('dQw4w9WgXcQ'));
    expect(bodies[0]).not.toHaveProperty('separation_quality');

    act(() => result.current.setSeparationQuality('fast'));
    expect(localStorage.getItem(SEPARATION_QUALITY_STORAGE_KEY)).toBe('fast');
    await act(() => result.current.handleSelectTrack('dQw4w9WgXcQ'));
    expect(bodies[1]).toMatchObject({ url_or_id: 'dQw4w9WgXcQ', separation_quality: 'fast' });
    const file = new File(['RIFF'], 'song.wav', { type: 'audio/wav' });
    await act(() => result.current.handleUploadTrack({ file }));
    expect(bodies[2]).toMatchObject({ separation_quality: 'fast', created_by: 'Ana' });
    unmount();

    // A fresh studio session starts from the remembered choice; junk is ignored
    const again = renderHook(() => useTrackIntake({ currentUser: 'Ana', setProject }), {
      wrapper,
    });
    expect(again.result.current.separationQuality).toBe('fast');
    again.unmount();
    localStorage.setItem(SEPARATION_QUALITY_STORAGE_KEY, 'ultra');
    const junk = renderHook(() => useTrackIntake({ currentUser: 'Ana', setProject }), { wrapper });
    expect(junk.result.current.separationQuality).toBeNull();
  });
});

describe('Server capabilities', () => {
  beforeEach(() => {
    resetCapabilitiesCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('are fetched once and shared', async () => {
    const fetchSpy = mockStudioFetch();
    const first = renderHook(() => useCapabilities());
    const second = renderHook(() => useCapabilities());
    await waitFor(() => expect(first.result.current).toEqual(CAPABILITIES));
    await waitFor(() => expect(second.result.current).toEqual(CAPABILITIES));
    expect(capabilityRequests(fetchSpy)).toBe(1);
    expect(renderHook(() => useCapabilities()).result.current).toEqual(CAPABILITIES);
  });

  it('wait until needed, and ignore answers of the wrong shape', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'not-capabilities' })));
    const { result, rerender } = renderHook(({ enabled }) => useCapabilities(enabled), {
      initialProps: { enabled: false },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
    // A failed answer is not kept: the next caller asks again
    fetchSpy.mockResolvedValue(json(CAPABILITIES));
    await expect(loadCapabilities()).resolves.toEqual(CAPABILITIES);
  });
});

describe('Quality labels and estimates', () => {
  it('describe durations, estimates and stems in words', () => {
    expect(formatDurationEstimate(30)).toBe('under a minute');
    expect(formatDurationEstimate(380)).toBe('about 6 min');
    expect(formatDurationEstimate(5400)).toBe('about 1.5 h');
    expect(separationEstimate(1.6, 240)).toBe('about 6 min on CPU');
    expect(separationEstimate(0.35)).toBe("about 0.35× the song's length on CPU");
    expect(separationEstimate(6.4)).toBe("about 6.4× the song's length on CPU");
    expect(separationEstimate(0.4, 240, 'cloud-gpu')).toBe('about 2 min on a cloud GPU');
    expect(separationEstimate(0.2, null, 'cloud-gpu')).toBe(
      "about 0.2× the song's length on a cloud GPU"
    );
    expect(separationEstimate(1.6, 240, null)).toBe('about 6 min on CPU');
    expect(stemsLabel(undefined)).toBe('Fast · Demucs');
    expect(stemsLabel({ preset: 'balanced' })).toBe('Balanced · Mel-Band RoFormer');
    expect(stemsLabel({ preset: 'best', label: 'Best · custom pair' })).toBe('Best · custom pair');
    expect(stemsLabel({ preset: 'custom' })).toBe('Custom stems');
    expect(formatTimeLeft(null)).toBeNull();
    expect(formatTimeLeft(20)).toBe('under a minute left');
    expect(formatTimeLeft(600)).toBe('10 min left');
  });
});
