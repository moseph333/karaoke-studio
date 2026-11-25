/**
 * The home screen's tour: offered under "How it works" to a first-time visitor, and from
 * Help and the command palette to anyone. It points at the search box, the upload switch,
 * the advanced options, the setlist and Help, in that order.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { TrackSearch } from '../../components/TrackSearch';
import { loadDeferredScreens } from '../../deferredScreens';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';
import { tourStops } from '../../utils/guideStops';
import { mockGuideFetch } from '../helpers/guideFixtures';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

const titles = tourStops('home').map((stop) => stop.title);

async function openHome() {
  render(<App />);
  await screen.findByRole('heading', { level: 1 });
}

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  localStorage.clear();
  mockGuideFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('the home screen’s tour', () => {
  it('is offered under How it works on a first visit', async () => {
    await openHome();
    const section = screen.getByRole('region', { name: 'How it works' });
    const offer = within(section).getByRole('button', { name: 'Show me around' });
    expectTouchTarget(offer);
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
    expect(isModalActive()).toBe(false);
  });

  it('walks the home screen’s parts in order', async () => {
    const user = userEvent.setup();
    await openHome();
    await user.click(screen.getByRole('button', { name: 'Show me around' }));

    for (const [i, title] of titles.entries()) {
      const tour = await screen.findByRole('dialog');
      expect(tour).toHaveAccessibleName(title);
      expect(within(tour).getByText(`${i + 1} of ${titles.length}`)).toBeInTheDocument();
      const last = i === titles.length - 1;
      await user.click(within(tour).getByRole('button', { name: last ? 'Done' : 'Next' }));
    }
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show me around' })).toHaveFocus();
  });

  it('is not pressed on a returning visitor, who has no How it works', async () => {
    localStorage.setItem('karaoke_has_songs', '1');
    await openHome();
    expect(screen.queryByRole('region', { name: 'How it works' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show me around' })).toBeNull();
  });

  it('starts from the command palette for a returning visitor', async () => {
    localStorage.setItem('karaoke_has_songs', '1');
    const user = userEvent.setup();
    await openHome();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('combobox', { name: /search commands/i }), 'tour');
    await user.click(await screen.findByRole('option', { name: /Show me around/ }));

    expect(await screen.findByRole('dialog', { name: titles[0] })).toBeInTheDocument();
  });

  it('starts from Help, which steps aside for it', async () => {
    const user = userEvent.setup();
    await openHome();
    fireEvent.keyDown(window, { key: '?' });
    await user.click(await screen.findByRole('tab', { name: 'What you can do' }));
    await user.click(screen.getByRole('button', { name: 'Start the tour' }));

    expect(await screen.findByRole('dialog', { name: titles[0] })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'What you can do' })).toBeNull();
  });

  it('has no button where nothing starts a tour', () => {
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    expect(screen.getByRole('region', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me around' })).toBeNull();
  });
});
