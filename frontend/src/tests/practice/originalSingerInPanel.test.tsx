/**
 * The original singer's switch in the studio's practice panel: on and off without asking the
 * server for a new mix, a level of its own, the O key, and plain words when the singer's
 * track is missing, failed, or already mixed into the master.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import type { ProjectState } from '../../types';
import { PRACTICE_SONG, PRACTICE_VOCAL_URL, mockPracticeFetch } from '../helpers/practiceFixtures';
import { captureAudioPlayers } from '../helpers/audioPlayers';
import { json, mockStudioFetch } from '../helpers/qualityFixtures';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

beforeAll(() => loadDeferredScreens());

let players: HTMLAudioElement[] = [];
let fetchSpy: ReturnType<typeof mockPracticeFetch>;

async function openPractice(song: ProjectState = PRACTICE_SONG, mock = true) {
  if (mock) fetchSpy = mockPracticeFetch(song);
  window.history.pushState({}, '', `/?project=${song.id}&practice=1`);
  render(<App />);
  await screen.findByTestId('practice-panel');
}

const singerSwitch = () => screen.getByRole('switch', { name: 'Original singer' });
const level = () => screen.queryByRole('slider', { name: 'Original singer level' });
const vocal = () => players[players.length - 1];
const requests = (path: string) =>
  fetchSpy.mock.calls.filter(([input]) => input.toString().includes(path));
/** The singer's track has loaded in the browser. */
async function vocalLoaded() {
  await waitFor(() => expect(vocal()?.src).toContain(PRACTICE_VOCAL_URL));
  act(() => void vocal().dispatchEvent(new Event('canplay')));
}

describe('the original singer in the practice panel', () => {
  beforeEach(() => {
    localStorage.clear();
    players = captureAudioPlayers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('asks where the singer’s track is when practice opens, at the song’s key', async () => {
    await openPractice();
    await vocalLoaded();
    const [request] = requests('/practice-vocal');
    expect(request[0].toString()).toBe(`/api/project/${PRACTICE_SONG.id}/practice-vocal`);
    expect(JSON.parse(String(request[1]?.body))).toEqual({ semitones: 0 });
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Hear the singer over the music, on and off at once.')).toBeVisible();
  });

  it('switches the singer on and off without a new mix', async () => {
    await openPractice();
    await vocalLoaded();

    fireEvent.click(singerSwitch());
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('The singer is in. Switch off to sing it alone.')).toBeVisible();
    expect(level()).toBeInTheDocument();

    fireEvent.click(singerSwitch());
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(level()).toBeNull();

    expect(requests('/mix')).toHaveLength(0);
    expect(requests('/practice-vocal')).toHaveLength(1);
    // The page still has the one player
    expect(screen.getAllByTestId('audio-element')).toHaveLength(1);
    expect(document.querySelectorAll('audio')).toHaveLength(1);
  });

  it('switches with the O key, in practice only', async () => {
    await openPractice();
    await vocalLoaded();
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.body, { key: 'O' });
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Back to the timeline' }));
    fireEvent.keyDown(document.body, { key: 'o' });
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('has a level of its own, remembered', async () => {
    await openPractice();
    await vocalLoaded();
    fireEvent.click(singerSwitch());
    expect(level()).toHaveValue('80');
    expect(level()).toHaveAttribute('aria-valuetext', '80% of the singer');

    fireEvent.change(level()!, { target: { value: '45' } });

    expect(level()).toHaveValue('45');
    expect(localStorage.getItem('karaoke_practice_vocal_level')).toBe('0.45');
    expectTouchTarget(level());
  });

  it('switches the singer off when practice is left', async () => {
    await openPractice();
    await vocalLoaded();
    fireEvent.click(singerSwitch());

    fireEvent.click(screen.getByRole('button', { name: 'Back to the timeline' }));
    expect(vocal().paused).toBe(true);
    expect(vocal().getAttribute('src')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('says so for a song without a separate vocal track', async () => {
    await openPractice({ ...PRACTICE_SONG, vocals_url: undefined });
    expect(singerSwitch()).toBeDisabled();
    expect(screen.getByText('This song has no separate vocal track.')).toBeVisible();
    expect(requests('/practice-vocal')).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'o' });
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('says so when the track cannot be loaded, and tries again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    fetchSpy = mockStudioFetch((url) => {
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/practice-vocal')) {
        return fail
          ? json({ detail: 'Could not make the vocal track.' }, 500)
          : json({ status: 'ok', url: PRACTICE_VOCAL_URL, semitones: 0 });
      }
      if (url.includes(`/api/project/${PRACTICE_SONG.id}`)) return json(PRACTICE_SONG);
      return undefined;
    });
    await openPractice(PRACTICE_SONG, false);

    const again = await screen.findByRole('button', { name: 'Try the singer’s track again' });
    expect(screen.getByText('The singer’s track could not be loaded.')).toBeVisible();
    expectTouchTarget(again);

    fail = false;
    fireEvent.click(again);
    await vocalLoaded();
    expect(screen.queryByRole('button', { name: 'Try the singer’s track again' })).toBeNull();
  });

  it('offers to take the singer out of a mix that already has them in', async () => {
    await openPractice({ ...PRACTICE_SONG, guide_volume: 0.2 });
    const panel = within(screen.getByTestId('practice-panel'));
    expect(panel.getByText(/The mix itself has the singer in it at 20%/)).toBeVisible();

    fireEvent.click(panel.getByRole('button', { name: 'Take the singer out of the mix' }));

    await waitFor(() => expect(requests('/mix')).toHaveLength(1), { timeout: 3000 });
    expect(JSON.parse(String(requests('/mix')[0][1]?.body))).toMatchObject({
      semitones: 0,
      guide_volume: 0,
    });
    await waitFor(() => expect(panel.queryByText(/The mix itself has the singer/)).toBeNull());
  });

  it('says nothing about the mix when the singer is not in it', async () => {
    await openPractice();
    expect(screen.queryByText(/The mix itself has the singer/)).toBeNull();
    expect(screen.queryByText(/play twice/)).toBeNull();
  });

  it('warns that vocals kept in the mix play twice with the singer on', async () => {
    await openPractice({ ...PRACTICE_SONG, vocal_levels: { backing: 1 } });
    await vocalLoaded();
    expect(screen.queryByText(/play twice/)).toBeNull();
    fireEvent.click(singerSwitch());
    expect(
      screen.getByText(
        'This mix keeps some of the vocals, so they play twice while the singer is on.'
      )
    ).toBeVisible();
  });

  it('asks for the track again at the new key when the key changes', async () => {
    await openPractice();
    await vocalLoaded();

    fireEvent.click(screen.getByRole('button', { name: /increase pitch/i }));

    await waitFor(() => expect(requests('/practice-vocal')).toHaveLength(2), { timeout: 3000 });
    expect(JSON.parse(String(requests('/practice-vocal')[1][1]?.body))).toEqual({ semitones: 1 });
    await waitFor(() => expect(vocal().src).toContain('/static/output/vocal_1.wav'));
  });

  it('keeps the singer’s switch where the song has no lines to repeat', async () => {
    await openPractice({ ...PRACTICE_SONG, lines: [] });
    await vocalLoaded();
    fireEvent.click(singerSwitch());
    expect(singerSwitch()).toHaveAttribute('aria-checked', 'true');
  });
});
