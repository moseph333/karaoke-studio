/**
 * A song whose mix keeps one singer by their lyric lines: the levels show in the Mix panel,
 * a save that moves those lines asks for the mix again, and a video render is asked for with
 * the same vocals.
 */

import { loadDeferredScreens } from '../../deferredScreens';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import type { ProjectState } from '../../types';
import { json, mockStudioFetch } from '../helpers/qualityFixtures';

const duet: ProjectState = {
  id: 'duet-song',
  title: 'Two Voices',
  artist: 'The Pair',
  status: 'ready',
  progress: 100,
  duration: 60,
  lines: [
    { id: 1, text: 'I sing this', start_time: 1, end_time: 3, words: [], singer: 'singer1' },
    { id: 2, text: 'You sing that', start_time: 5, end_time: 7, words: [], singer: 'singer2' },
  ],
  semitones: 0,
  guide_volume: 0,
  vocal_levels: { by: 'lines', singer1: 0, singer2: 1 },
  vocal_splits: { lead_backing: { model: 'm' } },
  master_audio_url: '/static/output/duet-song_mix_0_0_aaaaaaaa.wav?v=1',
  instrumental_url: '/static/stems/duet-song/instrumental.wav',
};

describe('a mix that follows the singers` lines', () => {
  let served: ProjectState;
  let requests: { url: string; body: Record<string, unknown> }[];
  let mixStatus: number;

  beforeAll(() => loadDeferredScreens());

  beforeEach(() => {
    resetCapabilitiesCache();
    served = duet;
    requests = [];
    mixStatus = 200;
    window.history.pushState({}, '', '/?project=duet-song');
    mockStudioFetch((url, init) => {
      if (url.includes('/api/auth/status'))
        return json({ auth_required: false, authenticated: true });
      if (init?.method === 'POST' && init.body && typeof init.body === 'string') {
        requests.push({ url, body: JSON.parse(init.body) });
      }
      if (url.endsWith('/mix')) {
        if (mixStatus !== 200) return json({ detail: 'FFmpeg mixing failed' }, mixStatus);
        return json({
          status: 'ok',
          master_audio_url: `/static/output/duet-song_mix_0_0_bbbbbbbb.wav?v=${requests.length}`,
        });
      }
      if (url.endsWith('/lyrics'))
        return json({ status: 'ok', lines_count: 2, master_stale: true });
      if (url.includes('/api/project/duet-song')) return json(served);
      if (url.includes('/api/projects')) return json({ [duet.id]: duet });
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  const openStudio = async () => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
    await screen.findByText('Two Voices');
  };
  const mixes = () => requests.filter((r) => r.url.endsWith('/mix'));

  it('shows each singer`s level and the backing vocals, with the guide switched off', async () => {
    await openStudio();

    const singers = screen.getByTestId('vocal-singers');
    expect(within(singers).getByRole('radio', { name: 'By singer' })).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Singer 1 level' })).toHaveValue('0');
    expect(screen.getByRole('slider', { name: 'Singer 2 level' })).toHaveValue('1');
    expect(screen.getByRole('slider', { name: 'Backing vocals level' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Guide vocal volume level' })).toBeDisabled();
    expect(mixes()).toHaveLength(0);
  });

  it('mixes when a singer`s slider is released, with every level', async () => {
    await openStudio();
    const slider = screen.getByRole('slider', { name: 'Singer 1 level' });

    fireEvent.change(slider, { target: { value: '0.5' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(mixes()).toHaveLength(1), { timeout: 3000 });
    expect(mixes()[0].body).toEqual({
      semitones: 0,
      guide_volume: 0,
      vocal_levels: { singer1: 0.5, singer2: 1, by: 'lines' },
    });
  });

  it('asks for the mix again when the song opens with a stale one, once', async () => {
    served = { ...duet, master_stale: true };

    await openStudio();

    await waitFor(() => expect(mixes()).toHaveLength(1));
    expect(mixes()[0].body.vocal_levels).toEqual({ singer1: 0, singer2: 1, by: 'lines' });
    // The new master is playing, and nothing asks again
    await waitFor(() =>
      expect(screen.getByTestId('audio-element')).toHaveAttribute(
        'src',
        expect.stringContaining('duet-song_mix_0_0_bbbbbbbb.wav')
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mixes()).toHaveLength(1);
  });

  it('does not retry in a loop when that mix fails', async () => {
    served = { ...duet, master_stale: true };
    mixStatus = 500;

    await openStudio();

    await waitFor(() => expect(mixes()).toHaveLength(1));
    expect(await screen.findByText('FFmpeg mixing failed')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mixes()).toHaveLength(1);
  });

  it('sends the vocal levels with a video render', async () => {
    await openStudio();

    fireEvent.click(screen.getByTestId('studio-export-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Render 1080p Video' }));

    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/render'))).toBe(true));
    const body = requests.find((r) => r.url.endsWith('/render'))!.body;
    expect(body.vocal_levels).toEqual({ singer1: 0, singer2: 1, by: 'lines' });
    expect(body.guide_volume).toBe(0);
  });

  it('sends no vocal levels for a song that has none', async () => {
    served = { ...duet, vocal_levels: null };

    await openStudio();
    fireEvent.click(screen.getByTestId('studio-export-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Render 1080p Video' }));

    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/render'))).toBe(true));
    expect(requests.find((r) => r.url.endsWith('/render'))!.body).not.toHaveProperty(
      'vocal_levels'
    );
  });

  it('offers the lead and backing stems in the export dialog', async () => {
    await openStudio();

    fireEvent.click(screen.getByTestId('studio-export-btn'));

    expect(
      await screen.findByRole('button', { name: 'Download Backing Vocal Stem' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Lead Vocal Stem' })).toBeInTheDocument();
  });
});
