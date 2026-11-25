/**
 * The studio tour, from the first-song card: it opens only when asked for, steps through
 * the studio's parts in order, moves the phone tab to each part, and leaves the keyboard
 * shortcuts off only while it is up.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { GuideTour } from '../../components/guide/GuideTour';
import { loadDeferredScreens } from '../../deferredScreens';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';
import type { StudioWorkspaceTab } from '../../types';
import { TOURS, tourStops } from '../../utils/guideStops';
import { GUIDE_SONG, mockGuideFetch } from '../helpers/guideFixtures';
import {
  expectTouchTarget,
  resetTestViewport,
  setTestViewport,
} from '../helpers/responsiveTestUtils';

const total = TOURS.studio.length;
const titles = tourStops('studio').map((stop) => stop.title);

async function openStudio() {
  window.history.pushState({}, '', `/?project=${GUIDE_SONG.id}`);
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: GUIDE_SONG.title });
}

const startTour = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Show me around' }));
  return screen.findByRole('dialog');
};

beforeAll(() => loadDeferredScreens());

describe('the studio tour', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuideFetch();
    setTestViewport(375, 812);
  });

  afterEach(() => {
    // Unmounted first: resetting the viewport fires a resize the tour would answer
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('is not there until it is asked for', async () => {
    await openStudio();
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isModalActive()).toBe(false);
  });

  it('starts at the song and counts its stops', async () => {
    const user = userEvent.setup();
    await openStudio();
    const tour = await startTour(user);

    expect(tour).toHaveAccessibleName(titles[0]);
    expect(within(tour).getByText(`1 of ${total}`)).toBeInTheDocument();
    expect(tour).toHaveAttribute('aria-modal', 'true');
    expect(isModalActive()).toBe(true);
    expect(within(tour).getByRole('button', { name: 'Next' })).toHaveFocus();
    expect(within(tour).getByRole('button', { name: 'Back' })).toBeDisabled();
    for (const button of within(tour).getAllByRole('button')) expectTouchTarget(button);
  });

  it('walks every stop in order with Next and ends on Done', async () => {
    const user = userEvent.setup();
    await openStudio();
    await startTour(user);

    for (const [i, title] of titles.entries()) {
      const tour = screen.getByRole('dialog');
      expect(tour).toHaveAccessibleName(title);
      expect(within(tour).getByText(`${i + 1} of ${total}`)).toBeInTheDocument();
      const last = i === total - 1;
      await user.click(within(tour).getByRole('button', { name: last ? 'Done' : 'Next' }));
    }
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
    expect(isModalActive()).toBe(false);
  });

  it('moves the phone tab to the part it is pointing at', async () => {
    const user = userEvent.setup();
    await openStudio();
    await startTour(user);
    const tab = (name: RegExp) => screen.getByRole('tab', { name });
    const goTo = async (title: string) => {
      while (screen.getByRole('dialog').getAttribute('aria-labelledby')) {
        if (within(screen.getByRole('dialog')).queryByRole('heading', { name: title })) return;
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next' }));
      }
    };

    await goTo('Timeline');
    expect(tab(/Timeline/)).toHaveAttribute('aria-selected', 'true');
    await goTo('Audio mix');
    expect(tab(/Mix & Look/)).toHaveAttribute('aria-selected', 'true');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('A line’s tools');
    expect(tab(/Timeline/)).toHaveAttribute('aria-selected', 'true');
  });

  it('names the icon-only tools of a toolbar', async () => {
    const user = userEvent.setup();
    await openStudio();
    await startTour(user);
    while (!within(screen.getByRole('dialog')).queryByRole('heading', { name: 'Lyric tools' })) {
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Next' }));
    }
    const rows = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Undo and redo: take back an edit, or put it back',
      'Offset: move every line earlier or later',
      'Duet parts: give the lines to two singers',
      'Tap sync: time the lines by tapping along',
      'Re-import: other lyrics, or time them all again',
    ]);
  });

  it('steps with the arrow keys and leaves on Escape, back where it was started', async () => {
    const user = userEvent.setup();
    await openStudio();
    await startTour(user);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(titles[1]);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(titles[0]);
    // Before the first stop there is nowhere to go
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(titles[0]);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(isModalActive()).toBe(false);
    expect(screen.getByRole('button', { name: 'Show me around' })).toHaveFocus();
  });

  it('can be skipped from any stop but the last', async () => {
    const user = userEvent.setup();
    await openStudio();
    const tour = await startTour(user);
    await user.click(within(tour).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
  });
});

describe('starting a tour', () => {
  const page = () => (
    <>
      <div data-guide="song">Song</div>
      <div data-guide="transport">Transport</div>
    </>
  );

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('pauses a song that is playing, once', () => {
    const onTogglePlay = vi.fn();
    const props = {
      request: { tour: 'studio' } as const,
      activeTab: 'stage' as const,
      onSelectTab: vi.fn(),
      onTogglePlay,
      onEnd: vi.fn(),
    };
    const { rerender } = render(
      <>
        {page()}
        <GuideTour {...props} isPlaying />
      </>
    );
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    rerender(
      <>
        {page()}
        <GuideTour {...props} isPlaying={false} />
      </>
    );
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('pauses once though React runs its effects twice', () => {
    const onTogglePlay = vi.fn();
    render(
      <React.StrictMode>
        {page()}
        <GuideTour
          request={{ tour: 'studio' }}
          activeTab="stage"
          onSelectTab={vi.fn()}
          isPlaying
          onTogglePlay={onTogglePlay}
          onEnd={vi.fn()}
        />
      </React.StrictMode>
    );
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('leaves a paused song alone', () => {
    const onTogglePlay = vi.fn();
    render(
      <>
        {page()}
        <GuideTour
          request={{ tour: 'studio' }}
          activeTab="stage"
          onSelectTab={vi.fn()}
          isPlaying={false}
          onTogglePlay={onTogglePlay}
          onEnd={vi.fn()}
        />
      </>
    );
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('passes over the stops this screen does not have, both ways', async () => {
    const user = userEvent.setup();
    const onEnd = vi.fn();
    const Harness = () => {
      const [tab, setTab] = React.useState<StudioWorkspaceTab>('stage');
      return (
        <>
          {page()}
          <GuideTour
            request={{ tour: 'studio' }}
            activeTab={tab}
            onSelectTab={setTab}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onEnd={onEnd}
          />
        </>
      );
    };
    render(<Harness />);

    // Only the song and the transport are on this page: the tour goes from one to the other
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Your song');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Playback');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Your song');

    // Nothing is left after the transport, so stepping on from it ends the tour
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onEnd).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onEnd).toHaveBeenCalled();
  });
});
