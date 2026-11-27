/**
 * Practice in the studio: the song header's button swaps the timeline for the practice panel
 * and back, the address remembers it, and the timeline keeps its unsaved edits meanwhile.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { PRACTICE_SONG, mockPracticeFetch } from '../helpers/practiceFixtures';
import { resetTestViewport, setTestViewport } from '../helpers/responsiveTestUtils';

beforeAll(() => loadDeferredScreens());

async function openSong(search = `?project=${PRACTICE_SONG.id}`) {
  window.history.pushState({}, '', `/${search}`);
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: PRACTICE_SONG.title });
}

const practiceButton = () => screen.getByRole('button', { name: 'Practice' });
const panel = () => screen.queryByTestId('practice-panel');
const timeline = () => screen.getByTestId('studio-panel-timeline');

describe('practice in the studio', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPracticeFetch();
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('opens from the song header and takes the timeline’s place', async () => {
    await openSong();
    expect(panel()).toBeNull();
    expect(practiceButton()).toHaveAttribute('aria-expanded', 'false');
    expect(timeline()).not.toHaveAttribute('hidden');

    fireEvent.click(practiceButton());

    expect(panel()).toBeInTheDocument();
    expect(practiceButton()).toHaveAttribute('aria-expanded', 'true');
    expect(practiceButton()).toHaveAttribute('aria-controls', 'workspace-panel-practice');
    expect(timeline()).toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeInTheDocument();
    // The stage and the mix stay
    expect(screen.getByTestId('studio-panel-stage')).toBeInTheDocument();
    expect(screen.getByTestId('studio-panel-audio')).toBeInTheDocument();
  });

  it('lists the song’s parts', async () => {
    await openSong();
    fireEvent.click(practiceButton());
    const parts = within(screen.getByRole('list', { name: 'Parts of the song' }));
    expect(parts.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(
      [
        'Repeat part 1: Morning comes in slowly',
        'Repeat part 2: Carry me back home',
        'Repeat part 3: Hold the last note longer',
      ]
    );
  });

  it('keeps practice in the address, without a new history entry', async () => {
    await openSong();
    const entries = window.history.length;

    fireEvent.click(practiceButton());
    expect(window.location.search).toBe(`?project=${PRACTICE_SONG.id}&practice=1`);
    expect(window.history.length).toBe(entries);

    fireEvent.click(practiceButton());
    expect(window.location.search).toBe(`?project=${PRACTICE_SONG.id}`);
    expect(panel()).toBeNull();
  });

  it('opens in practice from a kept link', async () => {
    await openSong(`?project=${PRACTICE_SONG.id}&practice=1`);
    await waitFor(() => expect(panel()).toBeInTheDocument());
    expect(window.location.search).toBe(`?project=${PRACTICE_SONG.id}&practice=1`);
  });

  it('comes back to the timeline from the panel', async () => {
    await openSong();
    fireEvent.click(practiceButton());
    fireEvent.click(screen.getByRole('button', { name: 'Back to the timeline' }));
    expect(panel()).toBeNull();
    expect(timeline()).not.toHaveAttribute('hidden');
  });

  it('keeps an unsaved timeline edit through practice', async () => {
    await openSong();
    const editor = timeline();
    fireEvent.click(screen.getByRole('button', { name: 'Nudge line 1 0.2s later' }));
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

    fireEvent.click(practiceButton());
    fireEvent.click(practiceButton());

    // The same editor, not a new one: the edit is still waiting to be saved
    expect(timeline()).toBe(editor);
    expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
  });

  it('leaves practice when the phone’s Timeline tab is opened', async () => {
    setTestViewport(375, 812);
    await openSong();
    fireEvent.click(practiceButton());
    expect(panel()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
    expect(panel()).toBeNull();
    expect(timeline()).not.toHaveAttribute('hidden');
    expect(window.location.search).toBe(`?project=${PRACTICE_SONG.id}`);
  });

  it('shows practice on the phone’s Stage tab', async () => {
    setTestViewport(375, 812);
    await openSong();
    fireEvent.click(screen.getByRole('tab', { name: /mix/i }));
    fireEvent.click(practiceButton());
    expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'true');
    expect(panel()).toHaveClass('block');
  });

  it('takes practice out of the address with the song', async () => {
    await openSong(`?project=${PRACTICE_SONG.id}&practice=1`);
    await waitFor(() => expect(panel()).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /new song/i }));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('says so when the song has no lines to practise', async () => {
    vi.restoreAllMocks();
    mockPracticeFetch({ ...PRACTICE_SONG, lines: [] });
    await openSong();
    fireEvent.click(practiceButton());
    expect(within(panel()!).getByText(/no lyric lines yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Repeat this part' })).toBeNull();
  });
});
