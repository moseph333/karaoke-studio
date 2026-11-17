/**
 * The getting-started card a first-time user sees in the studio: its four steps, where each
 * one goes, and when it is shown.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { FirstSongCard } from '../../components/studio/FirstSongCard';
import { loadDeferredScreens } from '../../deferredScreens';
import { FIRST_SONG_HINT_KEY, useFirstSongGuide } from '../../hooks/useFirstSongGuide';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';
import type { LyricLine, ProjectState } from '../../types';
import { json, mockStudioFetch } from '../helpers/qualityFixtures';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

const line = (id: number, start: number, confidence: number): LyricLine => ({
  id,
  text: `Line number ${id}`,
  start_time: start,
  end_time: start + 3,
  words: [
    { word: 'Line', start_time: start, end_time: start + 1 },
    { word: 'number', start_time: start + 1, end_time: start + 2 },
    { word: `${id}`, start_time: start + 2, end_time: start + 3 },
  ],
  confidence,
  align_method: 'ctc',
});

const project: ProjectState = {
  id: 'first-proj',
  title: 'First Song',
  artist: 'The Beginners',
  status: 'ready',
  progress: 100,
  duration: 60,
  lines: [line(1, 5, 0.92), line(2, 10, 0.31)],
  semitones: 0,
  guide_volume: 0,
  lyric_timing: 'aligned',
  master_audio_url: '/static/output/first_master.wav',
  separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
  sync_report: { version: 1, engine: 'ctc', lines_total: 2, mean_confidence: 0.6 },
};

beforeAll(() => loadDeferredScreens());

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFirstSongGuide', () => {
  it('shows the card to a browser that never dismissed it, and remembers the dismissal', () => {
    const first = renderHook(() => useFirstSongGuide());
    expect(first.result.current.visible).toBe(true);
    // Showing it writes nothing: it stays until dismissed, on every song
    expect(localStorage.getItem(FIRST_SONG_HINT_KEY)).toBeNull();

    act(() => first.result.current.dismiss());
    expect(first.result.current.visible).toBe(false);
    expect(localStorage.getItem(FIRST_SONG_HINT_KEY)).toBe('1');

    expect(renderHook(() => useFirstSongGuide()).result.current.visible).toBe(false);
  });

  it('stays hidden for a browser that already saw the toast it replaced', () => {
    localStorage.setItem(FIRST_SONG_HINT_KEY, '1');
    expect(renderHook(() => useFirstSongGuide()).result.current.visible).toBe(false);
  });

  it('comes back when asked for, until dismissed again', () => {
    localStorage.setItem(FIRST_SONG_HINT_KEY, '1');
    const { result } = renderHook(() => useFirstSongGuide());

    act(() => result.current.show());
    expect(result.current.visible).toBe(true);
    expect(renderHook(() => useFirstSongGuide()).result.current.visible).toBe(true);
  });

  it('is skipped, not repeated, where storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(renderHook(() => useFirstSongGuide()).result.current.visible).toBe(false);
  });
});

describe('FirstSongCard', () => {
  it('lists four steps as buttons that go where they say', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<FirstSongCard toCheck={0} onAction={onAction} onDismiss={vi.fn()} />);

    const card = screen.getByRole('region', { name: 'Your first song' });
    const steps = within(card).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual([
      'Step 1. Play and singWords light up',
      'Step 2. Check lyricsWords and timing',
      'Step 3. Set your keyPlus guide vocal',
      'Step 4. Make a videoOr subtitles',
    ]);
    for (const step of steps) {
      const button = within(step).getByRole('button');
      expectTouchTarget(button);
      await user.click(button);
    }
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'play',
      'timeline',
      'mix',
      'export',
    ]);
  });

  it('sends step 2 to the song check-up when it has something to fix', async () => {
    const onAction = vi.fn();
    render(<FirstSongCard toCheck={3} onAction={onAction} onDismiss={vi.fn()} />);

    const step = screen.getByRole('button', { name: /Check lyrics/ });
    expect(step).toHaveTextContent('3 to look at');
    await userEvent.click(step);
    expect(onAction).toHaveBeenCalledWith('checkup');
  });

  it('is a plain region, so the keyboard shortcuts keep working while it shows', () => {
    render(<FirstSongCard toCheck={1} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isModalActive()).toBe(false);
    expect(screen.getByRole('button', { name: /Check lyrics/ })).toHaveTextContent('1 to look at');
  });

  it('has a button that hides it', async () => {
    const onDismiss = vi.fn();
    render(<FirstSongCard toCheck={0} onAction={vi.fn()} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the first-song steps' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('in the studio', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/?project=first-proj');
    mockStudioFetch((url) => {
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/api/project/first-proj')) return json(project);
      return undefined;
    });
  });

  it('greets a first-time user with the card, and step 2 opens the check-up', async () => {
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByRole('region', { name: 'Your first song' });
    await user.click(within(card).getByRole('button', { name: /Check lyrics/ }));

    expect(await screen.findByRole('dialog', { name: 'Song check-up' })).toBeInTheDocument();
  });

  it('opens the mix panel from step 3 and the export dialog from step 4', async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = await screen.findByRole('region', { name: 'Your first song' });

    await user.click(within(card).getByRole('button', { name: /Set your key/ }));
    expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');

    await user.click(within(card).getByRole('button', { name: /Make a video/ }));
    expect(await screen.findByRole('dialog', { name: /export/i })).toBeInTheDocument();
  });

  it('stays hidden once dismissed, and the command palette brings it back', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Hide the first-song steps' }));
    expect(screen.queryByRole('region', { name: 'Your first song' })).toBeNull();
    first.unmount();

    render(<App />);
    await screen.findByRole('button', { name: /^Song check-up:/ });
    expect(screen.queryByRole('region', { name: 'Your first song' })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('combobox', { name: /search commands/i }), 'first');
    await user.click(await screen.findByRole('option', { name: /Show the first-song steps/ }));

    expect(screen.getByRole('region', { name: 'Your first song' })).toBeInTheDocument();
  });
});
